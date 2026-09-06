import { TRADING_DEFAULTS } from '@fomo/domain';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeSweepService } from './sweep';

const mockPrisma = vi.hoisted(() => ({
  tradeTransaction: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@fomo/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const CHAIN_ID = 8453;

function fakeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    txHash: `0x${'a'.repeat(64)}`,
    submittedAt: new Date(),
    ...overrides,
  };
}

describe('TradeSweepService', () => {
  let getTransactionReceiptStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getTransactionReceiptStatus = vi.fn();
  });

  function buildService() {
    const chainReader = { getTransactionReceiptStatus } as unknown as ConstructorParameters<typeof TradeSweepService>[1];
    return new TradeSweepService(CHAIN_ID, chainReader, fakeLogger);
  }

  it('only ever looks at PENDING transactions on the configured chain', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([]);
    const service = buildService();

    await service.sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING', chainId: CHAIN_ID } }),
    );
  });

  it('marks a transaction CONFIRMED from a real success receipt', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tx-1' }, data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, expired: 0 });
  });

  it('marks a transaction FAILED from a real reverted receipt, never a silent success', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('reverted');

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(result.failed).toBe(1);
  });

  it('leaves a fresh, receipt-less transaction PENDING — never fabricates a status', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, expired: 0 });
  });

  it('expires a receipt-less transaction once it has waited past the configured timeout', async () => {
    const old = fakeRow({ submittedAt: new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 1) * 60_000) });
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([old]);
    getTransactionReceiptStatus.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
    );
    expect(result.expired).toBe(1);
  });

  it('continues past a single row that errors, so one RPC hiccup does not abort the whole batch', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow({ id: 'tx-bad' }), fakeRow({ id: 'tx-good' })]);
    getTransactionReceiptStatus.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce('success');

    const result = await buildService().sweepPendingTransactions();

    expect(result.checked).toBe(2);
    expect(result.confirmed).toBe(1);
    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledTimes(1);
  });
});
