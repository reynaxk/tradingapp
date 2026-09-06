import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, prisma } from '@fomo/db';
import { TRADING_DEFAULTS } from '@fomo/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { TransactionService } from './transaction.service';

const mockGetReceiptStatus = jest.fn();

jest.mock('@fomo/chain-adapters', () => ({
  EvmChainDataProvider: jest.fn().mockImplementation(() => ({
    getTransactionReceiptStatus: mockGetReceiptStatus,
  })),
}));

jest.mock('@fomo/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      tradeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      tradeQuote: { findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const WALLET = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 8453;
const TX_HASH = `0x${'a'.repeat(64)}`;

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = { CHAIN_ID, CHAIN_RPC_URL: 'https://mainnet.base.org' };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quote-1',
    userId: USER_ID,
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    tokenMarketId: 'market-1',
    side: 'BUY',
    inputToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    outputToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '100000000000000000000',
    platformFeeAmount: '500000000000000000',
    ...overrides,
  };
}

function fakeTransactionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    userId: USER_ID,
    walletAddress: WALLET,
    quoteId: 'quote-1',
    chainId: CHAIN_ID,
    txHash: TX_HASH,
    side: 'BUY',
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '100000000000000000000',
    platformFeeAmount: '500000000000000000',
    status: 'PENDING',
    failureReason: null,
    submittedAt: new Date(),
    confirmedAt: null,
    tokenMarket: {
      token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 },
      quoteToken: { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'WETH', decimals: 18 },
    },
    ...overrides,
  };
}

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionService(fakeConfig(), fakeLogger());
  });

  describe('submitTransaction', () => {
    it('rejects a malformed transaction hash before touching the database', async () => {
      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: '0xnothex' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.findUnique).not.toHaveBeenCalled();
    });

    it('404s on an unknown quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'missing', txHash: TX_HASH }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a quote that belongs to a different user', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a quote created for a different wallet than the one submitting', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ walletAddress: '0x9999999999999999999999999999999999999a' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a PENDING transaction row from a valid, owned quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.status).toBe('PENDING');
      expect(dto.txHash).toBe(TX_HASH);
      expect(mockedPrisma.tradeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ txHash: TX_HASH, userId: USER_ID }) }),
      );
    });

    it('is idempotent on quoteId — a retry for an already-submitted quote returns the existing row instead of creating a duplicate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.id).toBe('tx-1');
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects an idempotent quoteId hit that belongs to someone else', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('recovers from a (chainId, txHash) unique-constraint race by returning the row that won instead of erroring', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no existing row by quoteId
        .mockResolvedValueOnce(fakeTransactionRow()); // lookup by (chainId, txHash) after the race
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.id).toBe('tx-1');
    });

    it('never trusts the client for the final status — a submitted tx always starts PENDING regardless of any other input', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());

      await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      const createCall = (mockedPrisma.tradeTransaction.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.status).toBeUndefined(); // relies on the schema default, never client-set
    });
  });

  describe('getTransaction', () => {
    it('404s when the transaction does not belong to the caller', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }));

      await expect(service.getTransaction(USER_ID, 'tx-1')).rejects.toThrow(NotFoundException);
    });

    it('refreshes a PENDING transaction to CONFIRMED from a real receipt before returning it', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'CONFIRMED', confirmedAt: new Date() }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('marks a reverted receipt as FAILED, never as a silent success', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('reverted');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED', failureReason: 'Transaction reverted on-chain' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('FAILED');
    });

    it('leaves a transaction PENDING (never fabricates confirmation) when no receipt exists yet and it is not stale', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue(null);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('PENDING');
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('expires a PENDING transaction that has waited past the configured timeout with no receipt', async () => {
      const old = fakeTransactionRow({ submittedAt: new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 5) * 60_000) });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(old);
      mockGetReceiptStatus.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue({ ...old, status: 'EXPIRED' });

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('EXPIRED');
    });
  });

  describe('getHistory', () => {
    it('is always scoped to the caller\'s own userId — there is no parameter to widen it', async () => {
      (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([]);

      await service.getHistory(USER_ID, undefined, 20);

      expect(mockedPrisma.tradeTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
      );
    });
  });
});
