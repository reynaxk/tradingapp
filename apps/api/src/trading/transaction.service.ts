import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvmChainDataProvider } from '@fomo/chain-adapters';
import { Prisma, prisma } from '@fomo/db';
import { normalizeEvmAddress, TRADING_DEFAULTS, type TradeTransactionDto } from '@fomo/domain';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits } from 'viem';
import type { Env } from '../config/env';

const TRANSACTION_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true } },
} as const;

type TransactionRow = Prisma.TradeTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Owns the transaction lifecycle from "the wallet broadcast something" onward — see
 * docs/TRADING.md#transaction-lifecycle. Never marks a trade CONFIRMED from a client's
 * say-so: the only path to CONFIRMED/FAILED is a real on-chain receipt, checked here
 * on-demand (`getTransaction`) and by apps/workers' background sweep for anyone not
 * actively watching.
 */
@Injectable()
export class TransactionService {
  private readonly chainReader: EvmChainDataProvider;
  private readonly chainId: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.chainId = config.get('CHAIN_ID', { infer: true });
    this.chainReader = new EvmChainDataProvider({
      chain: { identifier: `eip155:${this.chainId}`, name: 'chain', nativeSymbol: 'ETH' },
      rpcUrl: config.get('CHAIN_RPC_URL', { infer: true }),
    });
    this.logger.setContext('TransactionService');
  }

  /**
   * Records a transaction the wallet has already signed and broadcast. Idempotent on
   * `(chainId, txHash)` and on `quoteId` (both unique) — a client retry (e.g. a flaky
   * response the first time) returns the existing row instead of erroring or creating a
   * duplicate. See docs/TRADING.md#idempotency.
   */
  async submitTransaction(params: { userId: string; walletAddress: string; quoteId: string; txHash: string }): Promise<TradeTransactionDto> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(params.txHash)) {
      throw new UnprocessableEntityException('txHash must be a well-formed 32-byte transaction hash');
    }
    const walletAddress = normalizeEvmAddress(params.walletAddress);

    const existingByQuote = await prisma.tradeTransaction.findUnique({
      where: { quoteId: params.quoteId },
      include: TRANSACTION_INCLUDE,
    });
    if (existingByQuote) {
      if (existingByQuote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
      return toDto(existingByQuote);
    }

    const quote = await prisma.tradeQuote.findUnique({ where: { id: params.quoteId } });
    if (!quote) throw new NotFoundException(`No quote "${params.quoteId}"`);
    if (quote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
    if (normalizeEvmAddress(quote.walletAddress) !== walletAddress) {
      throw new ForbiddenException('This quote was created for a different wallet');
    }

    try {
      const created = await prisma.tradeTransaction.create({
        data: {
          userId: params.userId,
          walletAddress,
          quoteId: quote.id,
          chainId: quote.chainId,
          txHash: params.txHash,
          tokenMarketId: quote.tokenMarketId,
          side: quote.side,
          inputToken: quote.inputToken,
          outputToken: quote.outputToken,
          inputAmount: quote.inputAmount,
          expectedOutputAmount: quote.expectedOutputAmount,
          platformFeeAmount: quote.platformFeeAmount,
        },
        include: TRANSACTION_INCLUDE,
      });
      this.logger.info({ transactionId: created.id, txHash: params.txHash }, 'trade submitted');
      return toDto(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Same (chainId, txHash) already recorded — a retry, not a new trade.
        const existing = await prisma.tradeTransaction.findUnique({
          where: { chainId_txHash: { chainId: quote.chainId, txHash: params.txHash } },
          include: TRANSACTION_INCLUDE,
        });
        if (existing) {
          if (existing.userId !== params.userId) throw new ForbiddenException('This transaction does not belong to you');
          return toDto(existing);
        }
      }
      throw error;
    }
  }

  /** Refreshes a still-PENDING transaction's status against a live receipt before
   *  returning it, so a user actively watching a trade sees it confirm promptly rather
   *  than waiting for the worker's next background sweep. */
  async getTransaction(userId: string, id: string): Promise<TradeTransactionDto> {
    const row = await prisma.tradeTransaction.findUnique({ where: { id }, include: TRANSACTION_INCLUDE });
    if (!row || row.userId !== userId) throw new NotFoundException(`No transaction "${id}"`);

    const refreshed = row.status === 'PENDING' ? await this.refreshStatus(row) : row;
    return toDto(refreshed);
  }

  async getHistory(userId: string, cursor: string | undefined, limit: number): Promise<CursorPage<TradeTransactionDto>> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const rows = await prisma.tradeTransaction.findMany({
      where: {
        userId,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: TRANSACTION_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map(toDto), nextCursor };
  }

  /** Shared by the on-demand check above and apps/workers' background sweep — the only
   *  two places a status is ever written. */
  async refreshStatus(row: TransactionRow): Promise<TransactionRow> {
    const receiptStatus = await this.chainReader.getTransactionReceiptStatus(row.txHash);
    if (receiptStatus === 'success') {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
        include: TRANSACTION_INCLUDE,
      });
    }
    if (receiptStatus === 'reverted') {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'FAILED', failureReason: 'Transaction reverted on-chain' },
        include: TRANSACTION_INCLUDE,
      });
    }

    const ageMinutes = (Date.now() - row.submittedAt.getTime()) / 60_000;
    if (ageMinutes > TRADING_DEFAULTS.pendingTransactionTimeoutMinutes) {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'EXPIRED', failureReason: 'No confirmation received within the expected time' },
        include: TRANSACTION_INCLUDE,
      });
    }
    return row;
  }
}

function toDto(row: TransactionRow): TradeTransactionDto {
  return {
    id: row.id,
    chainId: row.chainId,
    txHash: row.txHash,
    side: row.side as 'BUY' | 'SELL',
    token: { address: row.tokenMarket.token.contractAddress, symbol: row.tokenMarket.token.symbol, decimals: row.tokenMarket.token.decimals! },
    quoteToken: {
      address: row.tokenMarket.quoteToken.contractAddress,
      symbol: row.tokenMarket.quoteToken.symbol,
      decimals: row.tokenMarket.quoteToken.decimals!,
    },
    inputAmount: row.inputAmount,
    expectedOutputAmount: row.expectedOutputAmount,
    inputAmountFormatted: formatUnits(
      BigInt(row.inputAmount),
      row.side === 'BUY' ? row.tokenMarket.quoteToken.decimals! : row.tokenMarket.token.decimals!,
    ),
    expectedOutputAmountFormatted: formatUnits(
      BigInt(row.expectedOutputAmount),
      row.side === 'BUY' ? row.tokenMarket.token.decimals! : row.tokenMarket.quoteToken.decimals!,
    ),
    platformFeeAmount: row.platformFeeAmount,
    platformFeeAmountFormatted: formatUnits(
      BigInt(row.platformFeeAmount),
      row.side === 'BUY' ? row.tokenMarket.token.decimals! : row.tokenMarket.quoteToken.decimals!,
    ),
    status: row.status,
    failureReason: row.failureReason,
    submittedAt: row.submittedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

interface HistoryCursor {
  createdAt: string;
  id: string;
}
function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeCursor(raw: string): HistoryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<HistoryCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
