import { followedTraderTradeDedupeKey, NOTIFICATION_REALTIME_CHANNEL, whaleTradeDedupeKey } from '@fomo/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationFanoutService, type InsertedSwap } from './notification-fanout.service';

const mockPrisma = vi.hoisted(() => ({
  follow: { findMany: vi.fn() },
  wallet: { findMany: vi.fn() },
  tradeTransaction: { findMany: vi.fn() },
  notification: { findMany: vi.fn(), createMany: vi.fn() },
  notificationPreference: { findMany: vi.fn() },
  tokenMarket: { findUnique: vi.fn() },
  tokenTrendingState: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock('@fomo/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const WHALE_THRESHOLD = 25_000;

// Healthy inputs to computeTrendingScore — same shape as social.test.ts's `healthy` fixture.
const TRENDING_MARKET_HEALTHY = { volume24hUsd: 50_000, liquidityUsd: 100_000, uniqueTraders24h: 20, tradeCount24h: 40 };
const TRENDING_MARKET_UNHEALTHY = { volume24hUsd: 50_000, liquidityUsd: 0, uniqueTraders24h: 20, tradeCount24h: 40 };

function swap(overrides: Partial<InsertedSwap> = {}): InsertedSwap {
  return { id: 'swap-1', tokenMarketId: 'tm-1', traderAddress: '0xtrader', amountUsd: 100, ...overrides };
}

describe('NotificationFanoutService', () => {
  let fakeRedis: { publish: ReturnType<typeof vi.fn> };
  let service: NotificationFanoutService;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeRedis = { publish: vi.fn().mockResolvedValue(1) };
    service = new NotificationFanoutService(fakeRedis as unknown as Redis, fakeLogger, WHALE_THRESHOLD);

    mockPrisma.notification.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
    mockPrisma.wallet.findMany.mockResolvedValue([]);
    mockPrisma.follow.findMany.mockResolvedValue([]);
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([]);
    mockPrisma.tokenTrendingState.findUnique.mockResolvedValue(null);
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  describe('notifyFollowedTraderTrades', () => {
    it('creates a notification for a follower with the preference enabled, and publishes a realtime ping', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([{ userId: 'follower-1', walletAddress: '0xtrader' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);
      mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrisma.notification.findMany.mockResolvedValue([
        { id: 'notif-1', userId: 'follower-1', type: 'FOLLOWED_TRADER_TRADE', createdAt },
      ]);

      await service.notifyFollowedTraderTrades([swap({ id: 'swap-1' })]);

      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              userId: 'follower-1',
              type: 'FOLLOWED_TRADER_TRADE',
              dedupeKey: followedTraderTradeDedupeKey('swap-1'),
              swapId: 'swap-1',
            }),
          ],
          skipDuplicates: true,
        }),
      );
      expect(fakeRedis.publish).toHaveBeenCalledWith(
        NOTIFICATION_REALTIME_CHANNEL,
        JSON.stringify({ userId: 'follower-1', notificationId: 'notif-1', type: 'FOLLOWED_TRADER_TRADE', atIso: createdAt.toISOString() }),
      );
    });

    it('never notifies a follower who has disabled followedTraderTrades', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([{ userId: 'follower-1', walletAddress: '0xtrader' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { userId: 'follower-1', follows: true, likes: true, followedTraderTrades: false, whaleTrades: true, trendingTokens: true },
      ]);

      await service.notifyFollowedTraderTrades([swap()]);

      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('never self-notifies a user who follows their own wallet', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([{ userId: 'trader-user-1', walletAddress: '0xtrader' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);

      await service.notifyFollowedTraderTrades([swap()]);

      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('skips swaps with no attributable trader — never even queries follows', async () => {
      await service.notifyFollowedTraderTrades([swap({ traderAddress: null })]);

      expect(mockPrisma.follow.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('notifyWhaleTrades', () => {
    it('does not query anything for a trade below the whale threshold', async () => {
      await service.notifyWhaleTrades([swap({ amountUsd: 100 })]);

      expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('notifies a user with a prior CONFIRMED trade in that exact token', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]); // cooldown check: nothing on cooldown
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([{ userId: 'past-trader-1', tokenMarketId: 'tm-1' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);
      mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        { id: 'notif-2', userId: 'past-trader-1', type: 'WHALE_TRADE', createdAt },
      ]);

      await service.notifyWhaleTrades([swap({ id: 'swap-2', amountUsd: 50_000 })]);

      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              userId: 'past-trader-1',
              type: 'WHALE_TRADE',
              dedupeKey: whaleTradeDedupeKey('swap-2'),
              swapId: 'swap-2',
              tokenMarketId: 'tm-1',
            }),
          ],
        }),
      );
    });

    it('respects the per-token cooldown — no notification while a recent WHALE_TRADE exists for that token', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([{ tokenMarketId: 'tm-1' }]);

      await service.notifyWhaleTrades([swap({ amountUsd: 50_000 })]);

      expect(mockPrisma.tradeTransaction.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('never self-notifies the whale trader even if they have a confirmed trade history in that token', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([{ userId: 'trader-user-1', tokenMarketId: 'tm-1' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);

      await service.notifyWhaleTrades([swap({ amountUsd: 50_000 })]);

      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('bounds a burst: only the first eligible whale swap per token in one tick triggers notifications', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([{ userId: 'past-trader-1', tokenMarketId: 'tm-1' }]);
      mockPrisma.wallet.findMany.mockResolvedValue([{ address: '0xtrader', userId: 'trader-user-1' }]);
      mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);

      await service.notifyWhaleTrades([
        swap({ id: 'swap-a', tokenMarketId: 'tm-1', amountUsd: 50_000 }),
        swap({ id: 'swap-b', tokenMarketId: 'tm-1', amountUsd: 60_000 }),
      ]);

      expect(mockPrisma.notification.createMany).toHaveBeenCalledTimes(1);
      const data = mockPrisma.notification.createMany.mock.calls[0]![0].data;
      expect(data).toHaveLength(1);
      expect(data[0].dedupeKey).toBe(whaleTradeDedupeKey('swap-a'));
    });
  });

  describe('checkTrendingTransition', () => {
    it('does nothing when the token market cannot be found', async () => {
      mockPrisma.tokenMarket.findUnique.mockResolvedValue(null);

      await service.checkTrendingTransition('missing-market');

      expect(mockPrisma.tokenTrendingState.findUnique).not.toHaveBeenCalled();
    });

    it('notifies every preference-enabled user on a false -> true trending transition', async () => {
      mockPrisma.tokenMarket.findUnique.mockResolvedValue({ id: 'tm-1', ...TRENDING_MARKET_HEALTHY });
      mockPrisma.tokenTrendingState.findUnique.mockResolvedValue(null); // never tracked before -> wasTrending false
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
      mockPrisma.notification.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.notification.findMany.mockResolvedValue([
        { id: 'n1', userId: 'user-1', type: 'TRENDING_TOKEN', createdAt: new Date() },
        { id: 'n2', userId: 'user-2', type: 'TRENDING_TOKEN', createdAt: new Date() },
      ]);

      await service.checkTrendingTransition('tm-1');

      expect(mockPrisma.tokenTrendingState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ isTrending: true }) }),
      );
      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ userId: 'user-1', type: 'TRENDING_TOKEN', tokenMarketId: 'tm-1' }),
            expect.objectContaining({ userId: 'user-2', type: 'TRENDING_TOKEN', tokenMarketId: 'tm-1' }),
          ],
        }),
      );
      // Both recipients share the same dedupeKey — one shared "entered trending" event —
      // and it's shaped exactly like trendingTokenDedupeKey('tm-1', <transition time>).
      const data = mockPrisma.notification.createMany.mock.calls[0]![0].data;
      expect(data[0].dedupeKey).toBe(data[1].dedupeKey);
      expect(data[0].dedupeKey.startsWith('token:tm-1:since:')).toBe(true);
    });

    it('does not renotify while a token stays trending across ticks', async () => {
      mockPrisma.tokenMarket.findUnique.mockResolvedValue({ id: 'tm-1', ...TRENDING_MARKET_HEALTHY });
      mockPrisma.tokenTrendingState.findUnique.mockResolvedValue({ isTrending: true, becameTrendingAt: new Date() });

      await service.checkTrendingTransition('tm-1');

      expect(mockPrisma.tokenTrendingState.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('updates state but never notifies on exiting trending (true -> false)', async () => {
      mockPrisma.tokenMarket.findUnique.mockResolvedValue({ id: 'tm-1', ...TRENDING_MARKET_UNHEALTHY });
      mockPrisma.tokenTrendingState.findUnique.mockResolvedValue({ isTrending: true, becameTrendingAt: new Date() });

      await service.checkTrendingTransition('tm-1');

      expect(mockPrisma.tokenTrendingState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ isTrending: false }) }),
      );
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
    });
  });
});
