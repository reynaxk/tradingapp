import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvmChainDataProvider } from '@fomo/chain-adapters';
import { Prisma, prisma } from '@fomo/db';
import {
  normalizeEvmAddress,
  parseUnsignedTx,
  TRADING_DEFAULTS,
  transactionMatchesQuote,
  type TradeTransactionDto,
} from '@fomo/domain';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits } from 'viem';
import type { Env } from '../config/env';

const TRANSACTION_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true } },
  quote: true,
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
 * actively watching. Critically, a successful receipt alone is never sufficient either — a
 * receipt only proves *some* transaction with this hash succeeded, not that it's the trade
 * a quote actually described. See docs/TRADING.md#transaction-integrity: every CONFIRMED
 * transition re-verifies the transaction's real sender, destination, value, and calldata
 * against the persisted quote first.
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
   *
   * Security — see docs/TRADING.md#transaction-integrity and #authorization. Every one of
   * these is a real, previously-found gap this method now closes, not a hypothetical:
   *  1. Quote freshness is re-checked here, not just in the client — a stale quoteId can
   *     never be replayed against a later, unrelated transaction.
   *  2. Wallet ownership is re-derived from the database, not trusted from the quote's
   *     frozen snapshot — a wallet unlinked (or re-verified to a different account) after
   *     the quote was created can no longer be used to submit against it.
   *  3. If the transaction is already visible on-chain, its real sender/destination/value/
   *     calldata are checked against the quote *before* a row is ever created — an
   *     unrelated (even if genuinely successful) hash is rejected outright, not silently
   *     accepted and left for `refreshStatus` to eventually mis-confirm.
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

    // Quote freshness — see docs/TRADING.md#quote-expiration. A submission against an
    // expired quoteId is rejected here, not just checked client-side: this closes the
    // specific replay this gate exists for — reusing an old, stale quoteId to attach a
    // later, unrelated transaction hash to a trade Fomo never actually reviewed at that
    // price. It does not (and structurally cannot) undo a transaction the wallet already
    // broadcast; it only refuses to let Fomo's own records treat that broadcast as the
    // reviewed trade.
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException('This quote has expired — request a new one before submitting');
    }

    // Wallet ownership can change after a quote is created — a wallet can be unlinked, or
    // re-verified to a different account (see docs/TRADING.md#wallet-ownership) — so it's
    // re-derived from the database now rather than trusted from the quote's frozen
    // snapshot at creation time.
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }

    const expectedUnsignedTx = parseUnsignedTx(quote.unsignedTx);
    if (!expectedUnsignedTx) {
      // Only possible for a corrupted row — this codebase is the only writer of
      // unsignedTx — but a transaction-integrity check must never proceed from an
      // assumption it hasn't actually verified.
      this.logger.error({ quoteId: quote.id }, 'quote has an unparseable unsignedTx — refusing to accept a submission against it');
      throw new UnprocessableEntityException('This quote can no longer be submitted — request a new one');
    }

    // Best-effort, fail-fast check: if the transaction is already visible to our RPC
    // (mined, or already propagated to this node's mempool), verify it's actually the
    // transaction that was quoted — real sender, destination, value, and calldata, all
    // exactly matching — before ever creating a row for it. An arbitrary or unrelated hash
    // is rejected right here, with a clear reason, rather than silently accepted. If it
    // isn't visible yet (a very recent broadcast that hasn't propagated to this RPC), this
    // can't be decided from here — that's fine: `refreshStatus` below is the authoritative,
    // race-free gate (it only runs this same check once the transaction is actually mined)
    // and never marks CONFIRMED without it passing.
    const onChain = await this.chainReader.getTransactionDetails(params.txHash);
    if (onChain && !transactionMatchesQuote(onChain, { walletAddress, unsignedTx: expectedUnsignedTx })) {
      this.logger.warn({ quoteId: quote.id, txHash: params.txHash }, 'submitted transaction does not match the reviewed quote');
      throw new ForbiddenException('This transaction does not match the trade you reviewed');
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

  /**
   * Shared by the on-demand check above and apps/workers' background sweep — the only two
   * places a status is ever written. A successful receipt is necessary but never
   * sufficient for CONFIRMED — see docs/TRADING.md#transaction-integrity: the receipt only
   * proves *some* transaction with this hash succeeded, never that it's the specific trade
   * the persisted quote described. `row.quote.unsignedTx` (the exact thing the user was
   * shown and asked to sign) is what CONFIRMED is actually checked against.
   */
  async refreshStatus(row: TransactionRow): Promise<TransactionRow> {
    const receiptStatus = await this.chainReader.getTransactionReceiptStatus(row.txHash);
    if (receiptStatus === 'success') {
      const expectedUnsignedTx = parseUnsignedTx(row.quote.unsignedTx);
      const onChain = expectedUnsignedTx ? await this.chainReader.getTransactionDetails(row.txHash) : null;
      const matches =
        expectedUnsignedTx !== null &&
        onChain !== null &&
        transactionMatchesQuote(onChain, { walletAddress: row.walletAddress, unsignedTx: expectedUnsignedTx });

      if (!matches) {
        // A mined, successful receipt that doesn't match what was quoted is never left
        // PENDING (that would keep re-checking forever) and never CONFIRMED (that would be
        // exactly the fabrication this check exists to prevent) — it's a definite, terminal
        // mismatch.
        this.logger.error(
          { transactionId: row.id, txHash: row.txHash },
          'receipt succeeded but the on-chain transaction does not match the persisted quote — marking FAILED, not CONFIRMED',
        );
        return prisma.tradeTransaction.update({
          where: { id: row.id },
          data: { status: 'FAILED', failureReason: 'On-chain transaction does not match the reviewed trade' },
          include: TRANSACTION_INCLUDE,
        });
      }

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
