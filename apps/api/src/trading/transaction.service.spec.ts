import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, prisma } from '@fomo/db';
import { TRADING_DEFAULTS } from '@fomo/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { TransactionService } from './transaction.service';

const mockGetReceiptStatus = jest.fn();
const mockGetTransactionDetails = jest.fn();

jest.mock('@fomo/chain-adapters', () => ({
  EvmChainDataProvider: jest.fn().mockImplementation(() => ({
    getTransactionReceiptStatus: mockGetReceiptStatus,
    getTransactionDetails: mockGetTransactionDetails,
  })),
}));

jest.mock('@fomo/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      tradeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      tradeQuote: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const WALLET = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 8453;
const TX_HASH = `0x${'a'.repeat(64)}`;
const UNSIGNED_TX = { to: '0xcccccccccccccccccccccccccccccccccccccccc', data: '0xdeadbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };
/** Exactly matches WALLET/UNSIGNED_TX above — the "everything lines up" on-chain reading. */
const MATCHING_ON_CHAIN = { from: WALLET, to: UNSIGNED_TX.to, value: 0n, data: UNSIGNED_TX.data };

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
    unsignedTx: UNSIGNED_TX,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function fakeVerifiedWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return { address: WALLET, userId: USER_ID, verifiedAt: new Date(), ...overrides };
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
    quote: { unsignedTx: UNSIGNED_TX },
    ...overrides,
  };
}

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionService(fakeConfig(), fakeLogger());
    // Sensible "everything checks out" defaults — tests targeting a specific rejection
    // override just the one mock that needs to fail.
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet());
    mockGetTransactionDetails.mockResolvedValue(MATCHING_ON_CHAIN);
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

    it('rejects submission against an expired quote — a stale quoteId can never be replayed', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('treats the exact expiry instant as expired, not a boundary grace period', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(now) }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(UnprocessableEntityException);
      jest.restoreAllMocks();
    });

    it('rejects submission when the wallet is no longer linked to any account (e.g. unlinked after the quote was created)', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects submission when the wallet has since been re-verified to a different account', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects submission when the wallet is linked but its verification was cleared', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet({ verifiedAt: null }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an already-visible transaction whose sender does not match the quoted wallet — an unrelated hash, even a real one', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, from: '0x9999999999999999999999999999999999999a' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects an already-visible transaction whose destination does not match the quoted router/contract', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, to: '0x0000000000000000000000000000000000dead' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an already-visible transaction whose value or calldata does not match the quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, data: '0x00' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows submission through when the transaction is not yet visible to our RPC (a very recent broadcast) — refreshStatus is the authoritative gate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetTransactionDetails.mockResolvedValue(null);

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.status).toBe('PENDING');
    });

    it('creates a PENDING transaction row from a valid, owned quote whose on-chain details already match', async () => {
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

  describe('getTransaction / refreshStatus', () => {
    it('404s when the transaction does not belong to the caller', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }));

      await expect(service.getTransaction(USER_ID, 'tx-1')).rejects.toThrow(NotFoundException);
    });

    it('refreshes a PENDING transaction to CONFIRMED from a real receipt whose on-chain details match the persisted quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'CONFIRMED', confirmedAt: new Date() }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('never confirms a successful receipt for an unrelated transaction — the core transaction-integrity guarantee', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      // A real, successful receipt — but sent from a completely different wallet than the
      // one this trade was quoted for. Exactly the "arbitrary successful hash" attack.
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, from: '0x9999999999999999999999999999999999999a' });
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeTransactionRow({ status: 'FAILED', failureReason: 'On-chain transaction does not match the reviewed trade' }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('FAILED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('does not match') }) }),
      );
      // Decisive: CONFIRMED must never appear in any update call for this transaction.
      const updateCalls = (mockedPrisma.tradeTransaction.update as jest.Mock).mock.calls;
      expect(updateCalls.every((call) => call[0].data.status !== 'CONFIRMED')).toBe(true);
    });

    it('never confirms when the on-chain transaction cannot be read at all, even with a successful receipt', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetTransactionDetails.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).not.toBe('CONFIRMED');
    });

    it('never confirms when the persisted quote itself has an unparseable unsignedTx', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ quote: { unsignedTx: { garbage: true } } }));
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).not.toBe('CONFIRMED');
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
