import { prisma } from '@fomo/db';
import {
  computeTrendingScore,
  followedTraderTradeDedupeKey,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_REALTIME_CHANNEL,
  trendingTokenDedupeKey,
  watchedTokenActivityDedupeKey,
  whaleTradeDedupeKey,
  type NotificationPing,
  type NotificationPreferences,
  type NotificationType,
} from '@fomo/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** The subset of a just-inserted `Swap` row this service needs — passed in by
 *  MarketIngestionService right after `swap.createMany`, rather than re-selected here, since
 *  the caller already has (or can cheaply recover) every field below. */
export interface InsertedSwap {
  id: string;
  tokenMarketId: string;
  traderAddress: string | null;
  amountUsd: number;
}

/**
 * Creates FOLLOWED_TRADER_TRADE, WHALE_TRADE, and TRENDING_TOKEN notifications from
 * confirmed, indexed activity — see docs/NOTIFICATIONS.md. Deliberately triggered from
 * `Swap` rows the indexer has already persisted (this service's own two entry points are
 * called from MarketIngestionService.ingestSwapsForMarket, after the swap insert and after
 * the rollup recompute respectively), never from Phase 3's optimistic client-submitted
 * `TradeTransaction` — a reverted or never-broadcast transaction never reaches `Swap` at
 * all, so it can never trigger a notification here. See the Notification model's actor
 * comment in schema.prisma for why FOLLOWED_TRADER_TRADE/WHALE_TRADE reference a Wallet
 * (the trader) while FOLLOW/LIKE (apps/api/src/notifications) reference a User.
 *
 * Every write here goes through the same `dedupeKey` + unique-constraint idempotency
 * FollowService/LikeService use on the API side (see @fomo/domain/notifications), so a
 * crashed-and-retried tick, or the same swap seen twice across worker restarts, can never
 * duplicate a notification. Every public method is wrapped in try/catch by its caller in
 * ingestion.ts — a notification failure here must never break indexing.
 */
export class NotificationFanoutService {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly whaleTradeUsdThreshold: number,
  ) {}

  /** Notifies followers of a trader when that trader's swap lands — one notification per
   *  (follower, swap) pair, gated by each follower's own `followedTraderTrades` preference. */
  async notifyFollowedTraderTrades(swaps: InsertedSwap[]): Promise<void> {
    const traded = swaps.filter(
      (s): s is InsertedSwap & { traderAddress: string } => s.traderAddress !== null,
    );
    if (traded.length === 0) return;

    const traderAddresses = Array.from(new Set(traded.map((s) => s.traderAddress)));
    const [follows, traderWallets] = await Promise.all([
      prisma.follow.findMany({
        where: { walletAddress: { in: traderAddresses } },
        select: { userId: true, walletAddress: true },
      }),
      prisma.wallet.findMany({
        where: { address: { in: traderAddresses } },
        select: { address: true, userId: true },
      }),
    ]);
    if (follows.length === 0) return;

    const traderUserId = new Map(traderWallets.map((w) => [w.address, w.userId]));
    const followersByTrader = new Map<string, string[]>();
    for (const f of follows) {
      const list = followersByTrader.get(f.walletAddress) ?? [];
      list.push(f.userId);
      followersByTrader.set(f.walletAddress, list);
    }

    const followerUserIds = Array.from(new Set(follows.map((f) => f.userId)));
    const prefsByUser = await this.batchPreferences(followerUserIds);

    const candidates: { userId: string; dedupeKey: string; swapId: string }[] = [];
    for (const swap of traded) {
      const selfUserId = traderUserId.get(swap.traderAddress) ?? null;
      for (const userId of followersByTrader.get(swap.traderAddress) ?? []) {
        if (userId === selfUserId) continue; // never self-notify
        if (!this.preference(prefsByUser, userId, 'followedTraderTrades')) continue;
        candidates.push({
          userId,
          dedupeKey: followedTraderTradeDedupeKey(swap.id),
          swapId: swap.id,
        });
      }
    }
    if (candidates.length === 0) return;

    await this.bulkCreate('FOLLOWED_TRADER_TRADE', candidates);
  }

  /**
   * Notifies users with a real trading history in a token when a "whale" (>= the
   * configurable USD threshold) trade lands in it — see docs/NOTIFICATIONS.md#whale-trades.
   * Recipients are users with a CONFIRMED `TradeTransaction` in that exact token (a genuine,
   * existing interest signal from Phase 3), never a broadcast to the whole user base.
   * Bounded two ways against a burst of whale trades: a per-token cooldown across ticks
   * (`NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes`), and at most one triggering swap per
   * token within a single tick's own batch, even if several qualify.
   */
  async notifyWhaleTrades(swaps: InsertedSwap[]): Promise<void> {
    const whales = swaps.filter((s) => s.amountUsd >= this.whaleTradeUsdThreshold);
    if (whales.length === 0) return;

    const tokenMarketIds = Array.from(new Set(whales.map((s) => s.tokenMarketId)));
    const cooldownSince = new Date(
      Date.now() - NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes * 60_000,
    );
    const onCooldownRows = await prisma.notification.findMany({
      where: {
        type: 'WHALE_TRADE',
        tokenMarketId: { in: tokenMarketIds },
        createdAt: { gte: cooldownSince },
      },
      select: { tokenMarketId: true },
      distinct: ['tokenMarketId'],
    });
    const onCooldown = new Set(
      onCooldownRows.map((r) => r.tokenMarketId).filter((id): id is string => id !== null),
    );
    const eligible = whales.filter((s) => !onCooldown.has(s.tokenMarketId));
    if (eligible.length === 0) return;

    const eligibleTokenMarketIds = Array.from(new Set(eligible.map((s) => s.tokenMarketId)));
    const priorTraders = await prisma.tradeTransaction.findMany({
      where: { tokenMarketId: { in: eligibleTokenMarketIds }, status: 'CONFIRMED' },
      select: { userId: true, tokenMarketId: true },
      distinct: ['userId', 'tokenMarketId'],
    });
    if (priorTraders.length === 0) return;

    const recipientsByToken = new Map<string, string[]>();
    for (const t of priorTraders) {
      const list = recipientsByToken.get(t.tokenMarketId) ?? [];
      list.push(t.userId);
      recipientsByToken.set(t.tokenMarketId, list);
    }

    const traderAddresses = Array.from(
      new Set(eligible.map((s) => s.traderAddress).filter((a): a is string => a !== null)),
    );
    const traderWallets = traderAddresses.length
      ? await prisma.wallet.findMany({
          where: { address: { in: traderAddresses } },
          select: { address: true, userId: true },
        })
      : [];
    const traderUserId = new Map(traderWallets.map((w) => [w.address, w.userId]));

    const recipientUserIds = Array.from(new Set(priorTraders.map((t) => t.userId)));
    const prefsByUser = await this.batchPreferences(recipientUserIds);

    const candidates: {
      userId: string;
      dedupeKey: string;
      swapId: string;
      tokenMarketId: string;
    }[] = [];
    const notifiedTokenThisTick = new Set<string>();
    for (const swap of eligible) {
      if (notifiedTokenThisTick.has(swap.tokenMarketId)) continue;
      const recipients = recipientsByToken.get(swap.tokenMarketId) ?? [];
      if (recipients.length === 0) continue;

      const selfUserId = swap.traderAddress ? (traderUserId.get(swap.traderAddress) ?? null) : null;
      let notifiedAny = false;
      for (const userId of recipients) {
        if (userId === selfUserId) continue; // never self-notify
        if (!this.preference(prefsByUser, userId, 'whaleTrades')) continue;
        candidates.push({
          userId,
          dedupeKey: whaleTradeDedupeKey(swap.id),
          swapId: swap.id,
          tokenMarketId: swap.tokenMarketId,
        });
        notifiedAny = true;
      }
      if (notifiedAny) notifiedTokenThisTick.add(swap.tokenMarketId);
    }
    if (candidates.length === 0) return;

    await this.bulkCreate('WHALE_TRADE', candidates);
  }

  /**
   * Notifies users watching a token (see TokenWatch, docs/PHASE6_RETENTION_SOCIAL.md#notification-integration)
   * when a large trade lands in it. Deliberately reuses WHALE_TRADE's own "what counts as
   * meaningful" threshold (`whaleTradeUsdThreshold`) and cooldown
   * (`NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes`) rather than a second definition, and
   * excludes every watcher who already has real trading history in the token — that cohort
   * is WHALE_TRADE's own recipient set (see notifyWhaleTrades above), so the two notification
   * types' audiences are disjoint by construction and a user can never get both for the same
   * swap. Bounded exactly like notifyWhaleTrades: one cooldown check, one watcher query, one
   * prior-trader query, one preference batch — never a query per watcher or per token.
   */
  async notifyWatchedTokenActivity(swaps: InsertedSwap[]): Promise<void> {
    const large = swaps.filter((s) => s.amountUsd >= this.whaleTradeUsdThreshold);
    if (large.length === 0) return;

    const tokenMarketIds = Array.from(new Set(large.map((s) => s.tokenMarketId)));
    const cooldownSince = new Date(
      Date.now() - NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes * 60_000,
    );
    const onCooldownRows = await prisma.notification.findMany({
      where: {
        type: 'WATCHED_TOKEN_ACTIVITY',
        tokenMarketId: { in: tokenMarketIds },
        createdAt: { gte: cooldownSince },
      },
      select: { tokenMarketId: true },
      distinct: ['tokenMarketId'],
    });
    const onCooldown = new Set(
      onCooldownRows.map((r) => r.tokenMarketId).filter((id): id is string => id !== null),
    );
    const eligible = large.filter((s) => !onCooldown.has(s.tokenMarketId));
    if (eligible.length === 0) return;

    const eligibleTokenMarketIds = Array.from(new Set(eligible.map((s) => s.tokenMarketId)));
    const [watches, priorTraders] = await Promise.all([
      prisma.tokenWatch.findMany({
        where: { tokenMarketId: { in: eligibleTokenMarketIds } },
        select: { userId: true, tokenMarketId: true },
      }),
      prisma.tradeTransaction.findMany({
        where: { tokenMarketId: { in: eligibleTokenMarketIds }, status: 'CONFIRMED' },
        select: { userId: true, tokenMarketId: true },
        distinct: ['userId', 'tokenMarketId'],
      }),
    ]);
    if (watches.length === 0) return;

    const priorTradersByToken = new Map<string, Set<string>>();
    for (const t of priorTraders) {
      const set = priorTradersByToken.get(t.tokenMarketId) ?? new Set<string>();
      set.add(t.userId);
      priorTradersByToken.set(t.tokenMarketId, set);
    }

    const watchersByToken = new Map<string, string[]>();
    for (const w of watches) {
      if (priorTradersByToken.get(w.tokenMarketId)?.has(w.userId)) continue; // already WHALE_TRADE's audience
      const list = watchersByToken.get(w.tokenMarketId) ?? [];
      list.push(w.userId);
      watchersByToken.set(w.tokenMarketId, list);
    }
    if (watchersByToken.size === 0) return;

    const traderAddresses = Array.from(
      new Set(eligible.map((s) => s.traderAddress).filter((a): a is string => a !== null)),
    );
    const traderWallets = traderAddresses.length
      ? await prisma.wallet.findMany({
          where: { address: { in: traderAddresses } },
          select: { address: true, userId: true },
        })
      : [];
    const traderUserId = new Map(traderWallets.map((w) => [w.address, w.userId]));

    const recipientUserIds = Array.from(new Set(Array.from(watchersByToken.values()).flat()));
    const prefsByUser = await this.batchPreferences(recipientUserIds);

    const candidates: {
      userId: string;
      dedupeKey: string;
      swapId: string;
      tokenMarketId: string;
    }[] = [];
    const notifiedTokenThisTick = new Set<string>();
    for (const swap of eligible) {
      if (notifiedTokenThisTick.has(swap.tokenMarketId)) continue;
      const recipients = watchersByToken.get(swap.tokenMarketId) ?? [];
      if (recipients.length === 0) continue;

      const selfUserId = swap.traderAddress ? (traderUserId.get(swap.traderAddress) ?? null) : null;
      let notifiedAny = false;
      for (const userId of recipients) {
        if (userId === selfUserId) continue; // never self-notify
        if (!this.preference(prefsByUser, userId, 'watchedTokenActivity')) continue;
        candidates.push({
          userId,
          dedupeKey: watchedTokenActivityDedupeKey(swap.id),
          swapId: swap.id,
          tokenMarketId: swap.tokenMarketId,
        });
        notifiedAny = true;
      }
      if (notifiedAny) notifiedTokenThisTick.add(swap.tokenMarketId);
    }
    if (candidates.length === 0) return;

    await this.bulkCreate('WATCHED_TOKEN_ACTIVITY', candidates);
  }

  /**
   * Detects a false -> true transition in `computeTrendingScore` (reused directly from
   * @fomo/domain/social — never a second trending algorithm) for one token market, and
   * notifies on genuine entry into trending only, never on every tick's fluctuation or on
   * exit. Called once per market per tick, right after that market's own rollup recompute
   * (see ingestion.ts), since the score depends only on that market's own now-fresh stats.
   */
  async checkTrendingTransition(tokenMarketId: string): Promise<void> {
    const market = await prisma.tokenMarket.findUnique({ where: { id: tokenMarketId } });
    if (!market) return;

    const score = computeTrendingScore({
      volume24hUsd: market.volume24hUsd === null ? null : Number(market.volume24hUsd),
      liquidityUsd: market.liquidityUsd === null ? null : Number(market.liquidityUsd),
      uniqueTraders24h: market.uniqueTraders24h,
      tradeCount24h: market.tradeCount24h,
    });
    const isTrendingNow = score !== null;

    const state = await prisma.tokenTrendingState.findUnique({ where: { tokenMarketId } });
    const wasTrending = state?.isTrending ?? false;

    if (isTrendingNow === wasTrending) {
      if (!state)
        await prisma.tokenTrendingState.create({ data: { tokenMarketId, isTrending: false } });
      return;
    }

    const now = new Date();
    await prisma.tokenTrendingState.upsert({
      where: { tokenMarketId },
      create: {
        tokenMarketId,
        isTrending: isTrendingNow,
        becameTrendingAt: isTrendingNow ? now : null,
      },
      update: {
        isTrending: isTrendingNow,
        becameTrendingAt: isTrendingNow ? now : (state?.becameTrendingAt ?? null),
      },
    });

    if (!isTrendingNow) return; // exiting trending never notifies, only entering does

    // Every user with trendingTokens enabled — unlike whale trades, trending is a discovery
    // feature meant to reach people not already engaged with this token, so there is no
    // narrower "prior interest" cohort to scope this to. Bounded by *frequency* instead (a
    // token can only trigger this once per continuous trending streak, via the
    // false->true-transition check above), not by audience size — see
    // docs/NOTIFICATIONS.md#trending-tokens for the tradeoff this implies at very large
    // user counts.
    const enabledUsers = await prisma.user.findMany({
      where: {
        OR: [
          { notificationPreference: null },
          { notificationPreference: { trendingTokens: true } },
        ],
      },
      select: { id: true },
    });
    if (enabledUsers.length === 0) return;

    const dedupeKey = trendingTokenDedupeKey(tokenMarketId, now.toISOString());
    await this.bulkCreate(
      'TRENDING_TOKEN',
      enabledUsers.map((u) => ({ userId: u.id, dedupeKey, tokenMarketId })),
    );
  }

  private preference(
    prefsByUser: Map<string, NotificationPreferences>,
    userId: string,
    field: keyof NotificationPreferences,
  ): boolean {
    return (prefsByUser.get(userId) ?? NOTIFICATION_DEFAULTS.preferenceDefaults)[field];
  }

  private async batchPreferences(userIds: string[]): Promise<Map<string, NotificationPreferences>> {
    if (userIds.length === 0) return new Map();
    const rows = await prisma.notificationPreference.findMany({
      where: { userId: { in: userIds } },
    });
    return new Map(
      rows.map((row) => [
        row.userId,
        {
          follows: row.follows,
          likes: row.likes,
          followedTraderTrades: row.followedTraderTrades,
          whaleTrades: row.whaleTrades,
          trendingTokens: row.trendingTokens,
          watchedTokenActivity: row.watchedTokenActivity,
        },
      ]),
    );
  }

  /**
   * Bulk-inserts via `createMany({ skipDuplicates: true })` rather than looping individual
   * `create()` calls — the efficient-batching requirement in docs/NOTIFICATIONS.md, and
   * necessary here since a single popular trader's follower list can be large. `createMany`
   * doesn't return inserted ids (see the comment on this exact limitation in ingestion.ts
   * for `swap.createMany`), so recovering them for realtime publishing costs one follow-up
   * query keyed on the natural `(userId, type, dedupeKey)` unique index.
   */
  private async bulkCreate(
    type: NotificationType,
    candidates: { userId: string; dedupeKey: string; swapId?: string; tokenMarketId?: string }[],
  ): Promise<void> {
    const result = await prisma.notification.createMany({
      data: candidates.map((c) => ({
        userId: c.userId,
        type,
        dedupeKey: c.dedupeKey,
        swapId: c.swapId,
        tokenMarketId: c.tokenMarketId,
      })),
      skipDuplicates: true,
    });
    this.logger.info(
      { type, attempted: candidates.length, created: result.count },
      'Notification fan-out complete',
    );
    if (result.count === 0) return;

    const created = await prisma.notification.findMany({
      where: { type, OR: candidates.map((c) => ({ userId: c.userId, dedupeKey: c.dedupeKey })) },
      select: { id: true, userId: true, type: true, createdAt: true },
    });
    for (const row of created) {
      await this.publish({
        userId: row.userId,
        notificationId: row.id,
        type: row.type,
        atIso: row.createdAt.toISOString(),
      });
    }
  }

  /** Never allowed to fail the tick — a down Redis means the recipient finds out on their
   *  next fetch/reconnect instead of live, not a broken notification (it's already
   *  persisted by the time this runs). See docs/NOTIFICATIONS.md#failure-degradation. */
  private async publish(ping: NotificationPing): Promise<void> {
    try {
      await this.redis.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(ping));
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to publish realtime notification ping');
    }
  }
}
