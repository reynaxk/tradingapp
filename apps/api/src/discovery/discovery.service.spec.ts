import { prisma } from '@fomo/db';
import type { PinoLogger } from 'nestjs-pino';
import type { WatchlistService } from '../market/watchlist.service';
import type { ActivityService } from '../social/services/activity.service';
import { DiscoveryService } from './discovery.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    wallet: { findMany: jest.fn() },
    swap: { findMany: jest.fn(), groupBy: jest.fn() },
    tokenTrendingState: { findMany: jest.fn() },
    tokenMarket: { findMany: jest.fn() },
    activityLike: { groupBy: jest.fn(), findMany: jest.fn() },
    follow: { findMany: jest.fn() },
    tradeTransaction: { findMany: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function fakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;
}

function fakeRedis() {
  return { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
}

function fakeActivityService(): jest.Mocked<
  Pick<ActivityService, 'getPersonalizedFeedCandidates'>
> {
  return { getPersonalizedFeedCandidates: jest.fn() };
}

function fakeWatchlistService(): jest.Mocked<
  Pick<WatchlistService, 'getWatchedSet' | 'getWatcherCount'>
> {
  return { getWatchedSet: jest.fn().mockResolvedValue(new Set()), getWatcherCount: jest.fn() };
}

const WALLET_A = '0x1111111111111111111111111111111111aaaa';
const WALLET_B = '0x2222222222222222222222222222222222bbbb';

describe('DiscoveryService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let activity: ReturnType<typeof fakeActivityService>;
  let watchlist: ReturnType<typeof fakeWatchlistService>;
  let service: DiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    activity = fakeActivityService();
    watchlist = fakeWatchlistService();
    service = new DiscoveryService(
      redis as never,
      fakeLogger(),
      activity as never,
      watchlist as never,
    );
  });

  describe('activeTraders', () => {
    it('computes fresh on a cache miss and stores the result with a TTL', async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        { trader_address: WALLET_A, volume_usd: '500', trade_count: 3n },
      ]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { address: WALLET_A, displayName: 'Alex', avatarUrl: null },
      ]);

      const result = await service.activeTraders(10);

      expect(result).toEqual([
        { address: WALLET_A, displayName: 'Alex', avatarUrl: null, volumeUsd: 500, tradeCount: 3 },
      ]);
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('discovery:active-traders'),
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('returns the cached value without touching the database on a cache hit', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify([
          { address: WALLET_A, displayName: null, avatarUrl: null, volumeUsd: 1, tradeCount: 1 },
        ]),
      );

      const result = await service.activeTraders(10);

      expect(result).toHaveLength(1);
      expect(mockedPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('still computes correctly when Redis itself fails (read and write)', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockRejectedValue(new Error('redis down'));
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.activeTraders(10)).resolves.toEqual([]);
    });
  });

  describe('largeTrades', () => {
    it('queries only swaps at/above the large-trade threshold', async () => {
      (mockedPrisma.swap.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.activityLike.groupBy as jest.Mock).mockResolvedValue([]);

      await service.largeTrades(20);

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            volumeUsd: expect.objectContaining({ gte: expect.any(Number) }),
          }),
        }),
      );
    });
  });

  describe('risingTokens', () => {
    it('returns nothing when no token has recently entered trending', async () => {
      (mockedPrisma.tokenTrendingState.findMany as jest.Mock).mockResolvedValue([]);
      expect(await service.risingTokens(10)).toEqual([]);
      expect(mockedPrisma.tokenMarket.findMany).not.toHaveBeenCalled();
    });

    it('only queries states that are currently trending and became so within the window', async () => {
      (mockedPrisma.tokenTrendingState.findMany as jest.Mock).mockResolvedValue([]);
      await service.risingTokens(10);

      expect(mockedPrisma.tokenTrendingState.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isTrending: true,
            becameTrendingAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('risingTraders', () => {
    it('excludes a candidate whose 24h count is only in line with their historical average', async () => {
      // 80 total swaps over 40 days -> baseline 2/day, so the 2x bar is 4; today's 3 clears
      // the absolute floor (>=3) but not the multiplier bar.
      const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        { trader_address: WALLET_A, trade_count: 3n },
      ]);
      (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([
        { traderAddress: WALLET_A, _count: { _all: 80 } },
      ]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { address: WALLET_A, displayName: null, avatarUrl: null, firstSeenAt: fortyDaysAgo },
      ]);

      expect(await service.risingTraders(10)).toEqual([]);
    });

    it('includes a candidate genuinely trading above their historical pace', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        { trader_address: WALLET_B, trade_count: 5n },
      ]);
      // 10 total swaps over 10 days -> baseline 1/day; today's 5 clears the 2x bar easily.
      (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([
        { traderAddress: WALLET_B, _count: { _all: 10 } },
      ]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { address: WALLET_B, displayName: 'Bo', avatarUrl: null, firstSeenAt: tenDaysAgo },
      ]);

      const result = await service.risingTraders(10);
      expect(result).toHaveLength(1);
      expect(result[0]?.address).toBe(WALLET_B);
      expect(result[0]?.tradeCount24h).toBe(5);
    });
  });

  describe('personalizedDiscovery', () => {
    it('returns an empty list when no market clears the discovery gate', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);
      expect(await service.personalizedDiscovery('user-1', 10)).toEqual([]);
    });

    it('never queries a client-supplied user id — always the one the controller resolved from the session', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);
      await service.personalizedDiscovery('user-1', 10);
      // No market cleared the gate, so no further signal queries should fire at all —
      // confirms the candidate-gate short-circuits before any per-user lookup.
      expect(mockedPrisma.follow.findMany).not.toHaveBeenCalled();
    });

    it('folds in the watchlist signal — Phase 6, see docs/PHASE6_RETENTION_SOCIAL.md#personalization', async () => {
      const marketRow = {
        id: 'market-1',
        chain: { identifier: 'ethereum' },
        token: {
          contractAddress: '0xtoken',
          symbol: 'TOK',
          name: 'Token',
          decimals: 18,
          logoUrl: null,
        },
        quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
        dex: null,
        feeTier: null,
        priceUsd: 1,
        liquidityUsd: 50_000,
        volume24hUsd: 100_000,
        priceChange24hPct: 5,
        marketCapUsd: null,
        lastPriceUpdateAt: new Date(),
      };
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([marketRow]);
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.activityLike.findMany as jest.Mock).mockResolvedValue([]);
      watchlist.getWatchedSet.mockResolvedValue(new Set(['market-1']));

      const result = await service.personalizedDiscovery('user-1', 10);

      expect(watchlist.getWatchedSet).toHaveBeenCalledWith('user-1', ['market-1']);
      expect(result[0]?.reasons).toContain("You're watching this token");
    });
  });

  describe('personalizedFeed', () => {
    it('tags an item from a followed trader distinctly from general discovery', async () => {
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([{ walletAddress: WALLET_A }]);
      activity.getPersonalizedFeedCandidates.mockResolvedValue({
        items: [
          { id: 'a', trader: { address: WALLET_A, displayName: 'Alex', avatarUrl: null } } as never,
          { id: 'b', trader: { address: WALLET_B, displayName: null, avatarUrl: null } } as never,
        ],
        nextCursor: null,
      });

      const page = await service.personalizedFeed('user-1', undefined, 20);

      expect(page.items[0]?.reasonCode).toBe('FOLLOWED_TRADER');
      expect(page.items[0]?.reason).toBe('Because you follow Alex');
      expect(page.items[1]?.reasonCode).toBe('GENERAL_DISCOVERY');
    });
  });
});
