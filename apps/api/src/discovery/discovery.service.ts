import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@fomo/db';
import {
  computeActivityFrequencyPerDay,
  computeDiscoveryScore,
  computePersonalizationScore,
  buildPersonalizationReasons,
  DISCOVERY_CACHE_TTL_SECONDS,
  feedReasonText,
  FOLLOWED_TRADER_SIGNAL_WINDOW_HOURS,
  isRisingTrader,
  LARGE_TRADE_USD_THRESHOLD,
  MIN_TRADES_FOR_TRADER_RANKING,
  RISING_TOKEN_WINDOW_HOURS,
  RISING_TRADER_CONFIG,
  type FeedReasonCode,
  type PersonalizationSignals,
  type PersonalizedFeedItem,
  type PersonalizedFeedPage,
  type PersonalizedToken,
  type RisingToken,
  type RisingTrader,
  type SocialActivity,
  type TopTrader,
} from '@fomo/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { toMarketSummary, type MarketRow } from '../market/market.mapper';
import { toSocialActivity, toTopTrader } from '../social/social.mapper';
import { ActivityService } from '../social/services/activity.service';

const MARKET_INCLUDE = { token: true, quoteToken: true, chain: true } as const;
const ACTIVITY_INCLUDE = { tokenMarket: { include: { token: true, quoteToken: true, chain: true } }, trader: true } as const;
/** Bounded candidate pool for "rising traders" — never "every trader in the database," see
 *  the query comment on risingTraders below. */
const RISING_TRADER_CANDIDATE_LIMIT = 100;

/**
 * Discovery rankings and personalization — see docs/TRADER_INTELLIGENCE.md. Every public
 * ranking here is Redis-cached (cache-aside, explicit TTL, Postgres remains authoritative —
 * see docs/TRADER_INTELLIGENCE.md#caching); a cache failure degrades to computing fresh,
 * never to an error. Personalized endpoints are computed on demand — bounded to Phase 1's
 * own small tracked-market count (see MarketService#discover's comment on the same
 * assumption), never cached per-user.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly activity: ActivityService,
  ) {
    this.logger.setContext('DiscoveryService');
  }

  /** "Most active" — ranked by real 24h trade *count*, distinct from Top Traders (ranked by
   *  volume). Same trade-count floor and time window as Top Traders, see
   *  docs/TRADER_INTELLIGENCE.md#trader-discovery. */
  async activeTraders(limit: number): Promise<TopTrader[]> {
    return this.cached(`discovery:active-traders:${limit}`, async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60_000);
      const rows = await prisma.$queryRaw<{ trader_address: string; volume_usd: string; trade_count: bigint }[]>`
        SELECT trader_address, SUM(volume_usd) AS volume_usd, COUNT(*) AS trade_count
        FROM swaps
        WHERE trader_address IS NOT NULL AND block_timestamp >= ${since24h}
        GROUP BY trader_address
        HAVING COUNT(*) >= ${MIN_TRADES_FOR_TRADER_RANKING}
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
      `;
      if (rows.length === 0) return [];

      const wallets = await prisma.wallet.findMany({ where: { address: { in: rows.map((r) => r.trader_address) } } });
      const byAddress = new Map(wallets.map((w) => [w.address, w]));
      return rows.map((r) => toTopTrader(r.trader_address, byAddress.get(r.trader_address), Number(r.volume_usd), Number(r.trade_count)));
    });
  }

  /** Recent confirmed swaps at/above LARGE_TRADE_USD_THRESHOLD, across every tracked
   *  market — the same threshold Phase 4's whale-trade notifications use. */
  async largeTrades(limit: number): Promise<SocialActivity[]> {
    return this.cached(`discovery:large-trades:${limit}`, async () => {
      const rows = await prisma.swap.findMany({
        where: { volumeUsd: { gte: LARGE_TRADE_USD_THRESHOLD } },
        orderBy: { blockTimestamp: 'desc' },
        take: limit,
        include: ACTIVITY_INCLUDE,
      });
      const likeCounts = await batchLikeCounts(rows.map((r) => r.id));
      return rows.map((row) => toSocialActivity(row, likeCounts.get(row.id) ?? 0, null));
    });
  }

  /** Tokens that entered trending within RISING_TOKEN_WINDOW_HOURS — reuses Phase 4's
   *  TokenTrendingState transition tracking directly rather than a second momentum metric. */
  async risingTokens(limit: number): Promise<RisingToken[]> {
    return this.cached(`discovery:rising-tokens:${limit}`, async () => {
      const since = new Date(Date.now() - RISING_TOKEN_WINDOW_HOURS * 60 * 60_000);
      const states = await prisma.tokenTrendingState.findMany({
        where: { isTrending: true, becameTrendingAt: { gte: since } },
        orderBy: { becameTrendingAt: 'desc' },
        take: limit,
      });
      if (states.length === 0) return [];

      const markets = await prisma.tokenMarket.findMany({ where: { id: { in: states.map((s) => s.tokenMarketId) } }, include: MARKET_INCLUDE });
      const byId = new Map(markets.map((m) => [m.id, m]));

      return states.flatMap((s) => {
        const market = byId.get(s.tokenMarketId);
        if (!market || !s.becameTrendingAt) return [];
        return [{ market: toMarketSummary(market), becameTrendingAt: s.becameTrendingAt.toISOString() }];
      });
    });
  }

  /**
   * Wallets trading well above their own historical daily pace — see isRisingTrader in
   * @fomo/domain. Bounded to a candidate pool of at most RISING_TRADER_CANDIDATE_LIMIT
   * wallets clearing an absolute 24h floor (one raw aggregate query), then one further
   * bounded groupBy for their all-time totals — never "for every trader, query all swaps"
   * (see docs/TRADER_INTELLIGENCE.md#performance).
   */
  async risingTraders(limit: number): Promise<RisingTrader[]> {
    return this.cached(`discovery:rising-traders:${limit}`, async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60_000);
      const candidates = await prisma.$queryRaw<{ trader_address: string; trade_count: bigint }[]>`
        SELECT trader_address, COUNT(*) AS trade_count
        FROM swaps
        WHERE trader_address IS NOT NULL AND block_timestamp >= ${since24h}
        GROUP BY trader_address
        HAVING COUNT(*) >= ${RISING_TRADER_CONFIG.minTradeCount24h}
        ORDER BY COUNT(*) DESC
        LIMIT ${RISING_TRADER_CANDIDATE_LIMIT}
      `;
      if (candidates.length === 0) return [];

      const [totals, wallets] = await Promise.all([
        prisma.swap.groupBy({ by: ['traderAddress'], where: { traderAddress: { in: candidates.map((c) => c.trader_address) } }, _count: { _all: true } }),
        prisma.wallet.findMany({ where: { address: { in: candidates.map((c) => c.trader_address) } } }),
      ]);
      const totalByAddress = new Map(totals.map((t) => [t.traderAddress!, t._count._all]));
      const walletByAddress = new Map(wallets.map((w) => [w.address, w]));

      const rising = candidates.flatMap((c) => {
        const wallet = walletByAddress.get(c.trader_address);
        if (!wallet) return [];
        const totalSwaps = totalByAddress.get(c.trader_address) ?? 0;
        const tradeCount24h = Number(c.trade_count);
        if (!isRisingTrader({ tradeCount24h, totalSwaps, firstSeenAt: wallet.firstSeenAt })) return [];
        return [
          {
            address: c.trader_address,
            displayName: wallet.displayName,
            avatarUrl: wallet.avatarUrl,
            tradeCount24h,
            activityFrequencyPerDay: computeActivityFrequencyPerDay(totalSwaps, wallet.firstSeenAt) ?? 0,
          },
        ];
      });

      return rising.slice(0, limit);
    });
  }

  /**
   * Personalized token discovery — see docs/TRADER_INTELLIGENCE.md#personalization for the
   * full weighted formula. Candidate pool is exactly the same discovery-score-gated set
   * `/market/discover` ranks (bounded by Phase 1's own small tracked-market count — see
   * MarketService#discover's comment on the same assumption); every signal query below is
   * scoped `WHERE tokenMarketId IN (candidateIds)`, never a query per candidate. Never
   * cached (per-user), but cheap enough not to need to be at this scale.
   */
  async personalizedDiscovery(userId: string, limit: number): Promise<PersonalizedToken[]> {
    const markets = await prisma.tokenMarket.findMany({ include: MARKET_INCLUDE });
    const candidates = markets
      .map((row) => ({
        row,
        score: computeDiscoveryScore({
          volume24hUsd: row.volume24hUsd === null ? null : Number(row.volume24hUsd),
          liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
          priceChange24hPct: row.priceChange24hPct === null ? null : Number(row.priceChange24hPct),
          lastPriceUpdateAt: row.lastPriceUpdateAt,
        }),
      }))
      .filter((entry): entry is { row: MarketRow; score: number } => entry.score !== null);
    if (candidates.length === 0) return [];

    const candidateIds = candidates.map((c) => c.row.id);
    const since = new Date(Date.now() - FOLLOWED_TRADER_SIGNAL_WINDOW_HOURS * 60 * 60_000);

    const follows = await prisma.follow.findMany({ where: { userId }, select: { walletAddress: true } });
    const followedAddresses = follows.map((f) => f.walletAddress);

    const [followedTraderSwaps, viewerTrades, viewerLikedSwaps] = await Promise.all([
      followedAddresses.length > 0
        ? prisma.swap.findMany({
            where: { tokenMarketId: { in: candidateIds }, traderAddress: { in: followedAddresses }, blockTimestamp: { gte: since } },
            orderBy: { blockTimestamp: 'desc' },
            include: { trader: true },
          })
        : Promise.resolve([]),
      prisma.tradeTransaction.findMany({
        where: { userId, status: 'CONFIRMED', tokenMarketId: { in: candidateIds } },
        select: { tokenMarketId: true },
        distinct: ['tokenMarketId'],
      }),
      prisma.activityLike.findMany({
        where: { userId, swap: { tokenMarketId: { in: candidateIds } } },
        select: { swap: { select: { tokenMarketId: true } } },
      }),
    ]);

    // One pass over each bounded signal result to build per-token lookup maps — never a
    // second round of per-candidate queries.
    const followedTraderByToken = new Map<string, { label: string | null; hoursSince: number }>();
    for (const swap of followedTraderSwaps) {
      if (followedTraderByToken.has(swap.tokenMarketId)) continue; // already have the most recent (query is newest-first)
      followedTraderByToken.set(swap.tokenMarketId, {
        label: swap.trader?.displayName ?? null,
        hoursSince: (Date.now() - swap.blockTimestamp.getTime()) / 3_600_000,
      });
    }
    const viewerTradedSet = new Set(viewerTrades.map((t) => t.tokenMarketId));
    const likeCountByToken = new Map<string, number>();
    for (const like of viewerLikedSwaps) {
      const id = like.swap.tokenMarketId;
      likeCountByToken.set(id, (likeCountByToken.get(id) ?? 0) + 1);
    }

    const scored = candidates.map(({ row, score }) => {
      const followedSignal = followedTraderByToken.get(row.id) ?? null;
      const signals: PersonalizationSignals = {
        marketActivityScore: score,
        followedTraderLabel: followedSignal?.label ?? null,
        viewerHasTraded: viewerTradedSet.has(row.id),
        viewerLikeCount: likeCountByToken.get(row.id) ?? 0,
        hoursSinceRelevantActivity: followedSignal?.hoursSince ?? null,
      };
      return { row, personalizationScore: computePersonalizationScore(signals), signals };
    });

    scored.sort((a, b) => b.personalizationScore - a.personalizationScore);

    return scored.slice(0, limit).map(({ row, personalizationScore, signals }) => ({
      market: toMarketSummary(row),
      score: personalizationScore,
      reasons: buildPersonalizationReasons(signals),
    }));
  }

  /** See ActivityService#getPersonalizedFeedCandidates for the query itself — this layer
   *  only adds the "why this is here" reason per item. */
  async personalizedFeed(userId: string, cursor: string | undefined, limit: number): Promise<PersonalizedFeedPage> {
    const follows = await prisma.follow.findMany({ where: { userId }, select: { walletAddress: true } });
    const followedSet = new Set(follows.map((f) => f.walletAddress));

    const page = await this.activity.getPersonalizedFeedCandidates({ userId, cursor, limit });

    const items: PersonalizedFeedItem[] = page.items.map((item) => {
      const isFollowed = item.trader.address !== null && followedSet.has(item.trader.address);
      const reasonCode: FeedReasonCode = isFollowed ? 'FOLLOWED_TRADER' : 'GENERAL_DISCOVERY';
      return { activity: item, reasonCode, reason: feedReasonText(reasonCode, item.trader.displayName) };
    });

    return { items, nextCursor: page.nextCursor };
  }

  /** Cache-aside with an explicit TTL — Postgres is always the authoritative source these
   *  results are computed from; a Redis miss or outage just means computing fresh instead
   *  of failing (see docs/TRADER_INTELLIGENCE.md#caching). */
  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Discovery cache read failed — computing fresh');
    }

    const value = await compute();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', DISCOVERY_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Discovery cache write failed — result still served, just not cached');
    }

    return value;
  }
}

async function batchLikeCounts(swapIds: string[]): Promise<Map<string, number>> {
  if (swapIds.length === 0) return new Map();
  const counts = await prisma.activityLike.groupBy({ by: ['swapId'], where: { swapId: { in: swapIds } }, _count: { _all: true } });
  return new Map(counts.map((c) => [c.swapId, c._count._all]));
}
