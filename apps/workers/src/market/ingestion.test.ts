import { ACTIVITY_REALTIME_CHANNEL } from '@fomo/domain';
import { UniswapV3PoolReader } from '@fomo/chain-adapters';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketIngestionService } from './ingestion';
import { USDC_ADDRESS_BASE } from './seed-markets';

const mockPrisma = vi.hoisted(() => ({
  tokenMarket: {
    findMany: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  ingestionCursor: {
    update: vi.fn(),
  },
  wallet: {
    createMany: vi.fn(),
  },
  swap: {
    createMany: vi.fn(),
  },
  candle: {
    aggregate: vi.fn(),
    findFirst: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));

// `vi.mock` calls are hoisted above every import in this file, including the
// `MarketIngestionService` one above — by the time it runs, `@fomo/db` already resolves
// to this mock, so ingestion.ts's `import { prisma } from '@fomo/db'` gets it too.
vi.mock('@fomo/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const fakeRedis = { publish: vi.fn().mockResolvedValue(1) } as unknown as Redis;

const PAIR_ADDRESS = '0x1111111111111111111111111111111111aaaa';
const BASE_TOKEN_ADDRESS = '0x2222222222222222222222222222222222bbbb';
const TRADER_ADDRESS = '0x3333333333333333333333333333333333cccc';
const ROUTER_ADDRESS = '0x4444444444444444444444444444444444dddd';

function buildMarket(lastProcessedBlock: bigint) {
  return {
    id: 'market-1',
    chainId: 1,
    pairAddress: PAIR_ADDRESS,
    priceUsd: null,
    token: { contractAddress: BASE_TOKEN_ADDRESS, decimals: 18, symbol: 'TEST' },
    quoteToken: { contractAddress: USDC_ADDRESS_BASE, decimals: 6, symbol: 'USDC' },
    cursor: { lastProcessedBlock },
  };
}

const POOL_STATE = {
  token0: BASE_TOKEN_ADDRESS,
  token1: USDC_ADDRESS_BASE,
  feeTier: 3000,
  sqrtPriceX96: 1_000_000_000_000_000_000n,
  tick: 0,
};

const FAKE_SWAP_EVENT = {
  txHash: '0xabc0000000000000000000000000000000000000000000000000000000ab',
  logIndex: 0,
  blockNumber: 150n,
  amount0: 1_000_000_000_000_000_000n,
  amount1: -500_000_000n,
  sqrtPriceX96: 1_000_000_000_000_000_000n,
  sender: ROUTER_ADDRESS,
  recipient: TRADER_ADDRESS,
};

function newService() {
  const service = new MarketIngestionService(
    { chainIdentifier: 'eip155:8453', chainName: 'Base', chainNativeSymbol: 'ETH', rpcConfigKey: 'CHAIN_RPC_URL' },
    'http://127.0.0.1:0',
    fakeLogger,
    fakeRedis,
  );
  (service as unknown as { chainId: number }).chainId = 1;
  return service;
}

/** No candles ever recorded and no live price — the "recompute found nothing" default used
 *  by tests that aren't specifically exercising the volume24hUsd decay behavior. */
function stubEmptyRollupState() {
  mockPrisma.candle.aggregate.mockResolvedValue({ _sum: { volumeUsd: null } });
  mockPrisma.candle.findFirst.mockResolvedValue(null);
  mockPrisma.tokenMarket.findUniqueOrThrow.mockResolvedValue({ priceUsd: null });
  mockPrisma.$queryRaw.mockResolvedValue([{ trade_count: 0n, unique_traders: 0n }]);
}

beforeEach(() => {
  // Clears call history and implementations on every vi.fn() (mockPrisma.*, fakeLogger.*)
  // and restores every UniswapV3PoolReader.prototype spy from the previous test to its
  // real implementation, so each test starts from a clean slate.
  vi.restoreAllMocks();
});

describe('MarketIngestionService.ingestSwaps — cursor safety', () => {
  it('does not advance the cursor when eth_getLogs fails, so the range is retried next tick', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue(null);

    await newService().ingestSwaps();

    expect(mockPrisma.ingestionCursor.update).not.toHaveBeenCalled();
    expect(mockPrisma.swap.createMany).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pool: PAIR_ADDRESS }),
      expect.stringContaining('eth_getLogs failed'),
    );
  });

  it('advances the cursor after a successful eth_getLogs query that genuinely finds zero events', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([]);

    await newService().ingestSwaps();

    expect(mockPrisma.ingestionCursor.update).toHaveBeenCalledWith({
      where: { tokenMarketId: market.id },
      data: { lastProcessedBlock: 200n },
    });
    expect(mockPrisma.swap.createMany).not.toHaveBeenCalled();
  });

  it('advances the cursor only after real swaps are both fetched and persisted', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockResolvedValue({ count: 1 });

    await newService().ingestSwaps();

    expect(mockPrisma.swap.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ txHash: FAKE_SWAP_EVENT.txHash })]) }),
    );
    expect(mockPrisma.ingestionCursor.update).toHaveBeenCalledWith({
      where: { tokenMarketId: market.id },
      data: { lastProcessedBlock: 200n },
    });
  });

  it('publishes a new-activity event to Redis after persisting new swaps', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockResolvedValue({ count: 1 });

    await newService().ingestSwaps();

    expect(fakeRedis.publish).toHaveBeenCalledWith(
      ACTIVITY_REALTIME_CHANNEL,
      expect.stringContaining(market.id),
    );
  });

  it('does not fail the tick when the realtime publish itself fails', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockResolvedValue({ count: 1 });
    (fakeRedis.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Redis unreachable'));

    await expect(newService().ingestSwaps()).resolves.not.toThrow();
    // The swap itself — the correctness-critical part — still persisted and advanced the
    // cursor; only the best-effort realtime ping failed.
    expect(mockPrisma.ingestionCursor.update).toHaveBeenCalledWith({
      where: { tokenMarketId: market.id },
      data: { lastProcessedBlock: 200n },
    });
  });

  it("upserts a wallet for a new trader (the swap's recipient) before the swap referencing it", async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockResolvedValue({ count: 1 });

    const callOrder: string[] = [];
    mockPrisma.wallet.createMany.mockImplementation(async () => {
      callOrder.push('wallet');
      return { count: 1 };
    });
    (mockPrisma.swap.createMany as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('swap');
      return { count: 1 };
    });

    await newService().ingestSwaps();

    expect(mockPrisma.wallet.createMany).toHaveBeenCalledWith({
      data: [{ address: TRADER_ADDRESS.toLowerCase(), firstSeenAt: expect.any(Date) }],
      skipDuplicates: true,
    });
    expect(callOrder).toEqual(['wallet', 'swap']); // FK requires the wallet row to exist first
    expect(mockPrisma.swap.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ traderAddress: TRADER_ADDRESS.toLowerCase() }),
        ]),
      }),
    );
  });

  it("uses the swap's recipient as trader identity, not sender (usually a router)", async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockResolvedValue({ count: 1 });

    await newService().ingestSwaps();

    expect(mockPrisma.swap.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            traderAddress: TRADER_ADDRESS.toLowerCase(),
            senderAddress: ROUTER_ADDRESS.toLowerCase(),
          }),
        ]),
      }),
    );
    // Only the trader wallet (the recipient) is upserted — the router is never given a
    // trader profile just for having relayed someone else's swap.
    expect(mockPrisma.wallet.createMany).toHaveBeenCalledWith({
      data: [{ address: TRADER_ADDRESS.toLowerCase(), firstSeenAt: expect.any(Date) }],
      skipDuplicates: true,
    });
  });

  it('does not advance the cursor when persisting fetched swaps fails', async () => {
    const market = buildMarket(100n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    stubEmptyRollupState();
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents').mockResolvedValue([FAKE_SWAP_EVENT]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getBlockTimestamp').mockResolvedValue(new Date());
    mockPrisma.swap.createMany.mockRejectedValue(new Error('DB write failed'));

    await expect(newService().ingestSwaps()).rejects.toThrow('DB write failed');
    expect(mockPrisma.ingestionCursor.update).not.toHaveBeenCalled();
  });
});

describe('MarketIngestionService.ingestSwaps — 24h rollup decay', () => {
  it('recomputes volume24hUsd/priceChange24hPct every tick, even with zero new swaps', async () => {
    const market = buildMarket(200n); // cursor already at the chain head
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    const getSwapEvents = vi.spyOn(UniswapV3PoolReader.prototype, 'getSwapEvents');
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n); // no new blocks at all

    // This market traded before (a candle exists from >24h ago) but nothing fell in the
    // current 24h window — the honest answer is 0, not the stale figure from days ago.
    mockPrisma.candle.aggregate.mockResolvedValue({ _sum: { volumeUsd: null } });
    mockPrisma.candle.findFirst
      .mockResolvedValueOnce(null) // oldestRelevantCandle: none >= 24h old still within it
      .mockResolvedValueOnce({ bucketStart: new Date(Date.now() - 48 * 60 * 60_000), close: 100 }); // oldestCandleOverall
    mockPrisma.tokenMarket.findUniqueOrThrow.mockResolvedValue({ priceUsd: 120 });
    // No new swaps this tick, but the market traded plenty before — real historical
    // activity stats, not zeros just because nothing new arrived.
    mockPrisma.$queryRaw.mockResolvedValue([{ trade_count: 57n, unique_traders: 12n }]);

    await newService().ingestSwaps();

    expect(getSwapEvents).not.toHaveBeenCalled(); // nothing to scan — proves this isn't swap-count-gated
    expect(mockPrisma.tokenMarket.update).toHaveBeenCalledWith({
      where: { id: market.id },
      data: {
        volume24hUsd: 0,
        priceChange24hPct: expect.any(Number),
        tradeCount24h: 57,
        uniqueTraders24h: 12,
      },
    });
  });

  it('leaves volume24hUsd/tradeCount24h/uniqueTraders24h as unknown (not 0) for a market that has never had a swap indexed', async () => {
    const market = buildMarket(200n);
    mockPrisma.tokenMarket.findMany.mockResolvedValue([market]);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(POOL_STATE);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(200n);

    mockPrisma.candle.aggregate.mockResolvedValue({ _sum: { volumeUsd: null } });
    mockPrisma.candle.findFirst.mockResolvedValue(null); // no candle has ever existed
    mockPrisma.tokenMarket.findUniqueOrThrow.mockResolvedValue({ priceUsd: null });
    mockPrisma.$queryRaw.mockResolvedValue([{ trade_count: 0n, unique_traders: 0n }]);

    await newService().ingestSwaps();

    expect(mockPrisma.tokenMarket.update).toHaveBeenCalledWith({
      where: { id: market.id },
      data: {
        volume24hUsd: undefined,
        priceChange24hPct: null,
        tradeCount24h: undefined,
        uniqueTraders24h: undefined,
      },
    });
  });
});
