import { z } from 'zod';
import { DISCOVERY_RANKING, MarketSummarySchema } from './market';

export const ActivityActionSchema = z.enum(['BUY', 'SELL']);
export type ActivityAction = z.infer<typeof ActivityActionSchema>;

/**
 * Redis pub/sub channel the ingestion worker publishes to after persisting new swaps, and
 * the API subscribes to for its realtime activity stream — see docs/SOCIAL.md#realtime.
 * The published payload is a bare signal (market id + count), never the activity itself:
 * the worker doesn't know the API's response shape, and a client that misses a message
 * just catches up on its next poll/reconnect.
 */
export const ACTIVITY_REALTIME_CHANNEL = 'fomo:activity:new';

/**
 * One social activity feed item — a read-time projection of an indexed `Swap` (see the
 * comment on the Swap model in schema.prisma). Never a separately stored copy: `id` is the
 * underlying Swap's own id, so an activity item is exactly as stable and deduplicated as
 * the swap it represents. See docs/SOCIAL.md#activity-model.
 */
export const SocialActivitySchema = z.object({
  id: z.string().uuid(),
  chainIdentifier: z.string(),
  trader: z.object({
    /** Null on a pre-Phase-2 swap indexed before trader capture existed — see the
     *  traderAddress comment on Swap in schema.prisma. */
    address: z.string().nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  action: ActivityActionSchema,
  token: z.object({
    address: z.string(),
    symbol: z.string().nullable(),
    name: z.string().nullable(),
    logoUrl: z.string().nullable(),
  }),
  amountUsd: z.number(),
  tokenAmount: z.number(),
  priceUsd: z.number(),
  timestamp: z.string().datetime(),
  txHash: z.string(),
  chainId: z.number().int().positive(),
  social: z.object({
    likes: z.number().int().min(0),
    likedByMe: z.boolean().nullable(),
  }),
});
export type SocialActivity = z.infer<typeof SocialActivitySchema>;

/** Keyset cursor for activity feeds — see docs/SOCIAL.md#pagination for why offset
 *  pagination doesn't work for a high-frequency, constantly-growing feed. */
export const ActivityCursorSchema = z.object({
  blockTimestamp: z.string().datetime(),
  id: z.string().uuid(),
});
export type ActivityCursor = z.infer<typeof ActivityCursorSchema>;

/** Opaque, URL-safe cursor — base64url of the JSON keyset, never a raw offset or a bare id. */
export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decodes a client-supplied cursor. Returns `null` for anything malformed — a cursor is
 * untrusted client input (see docs/SOCIAL.md#security), and the correct response to garbage
 * is "start from the beginning," never a 500.
 */
export function decodeActivityCursor(raw: string): ActivityCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = ActivityCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Ranking gates and weights for trending tokens — see docs/SOCIAL.md#trending for the full
 * rationale. Deliberately distinct from `DISCOVERY_RANKING` (market.ts): Phase 1 ranks
 * `/market/discover` by volume/momentum/liquidity; trending is about broad-based real
 * trading *activity*, so a token with a rapid rise in unique traders and trade count can
 * surface even with modest raw volume, while a single whale trade on a thin pool cannot.
 */
export const TRENDING_RANKING = {
  weights: { volume: 0.35, uniqueTraders: 0.4, tradeCount: 0.25 },
  /** Same floor as Phase 1's discovery gate — a market this illiquid never trends, no
   *  matter how much activity a handful of trades produce. */
  minLiquidityUsd: DISCOVERY_RANKING.minLiquidityUsd,
  /** One trader hitting the same pool a dozen times isn't "trending" — it's one actor.
   *  Require real breadth before a token can surface. */
  minUniqueTraders24h: 3,
  minTradeCount24h: 5,
  minVolume24hUsd: 1_000,
} as const;

/**
 * Trending Score = w_volume·log10(1+volume24h) + w_uniqueTraders·log10(1+uniqueTraders24h)
 * + w_tradeCount·log10(1+tradeCount24h) — log-scaled so one whale token or one hyperactive
 * bot can't mathematically dominate every other factor, exactly like `computeDiscoveryScore`
 * in market.ts. Returns `null` (excluded from trending entirely, never scored low) for a
 * market that hasn't cleared every minimum threshold, or whose activity stats haven't been
 * computed yet at all (`null`, not `0` — see the TokenMarket comment in schema.prisma).
 */
export function computeTrendingScore(input: {
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  uniqueTraders24h: number | null;
  tradeCount24h: number | null;
}): number | null {
  const { volume24hUsd, liquidityUsd, uniqueTraders24h, tradeCount24h } = input;
  const { weights, minLiquidityUsd, minUniqueTraders24h, minTradeCount24h, minVolume24hUsd } = TRENDING_RANKING;

  if (liquidityUsd === null || liquidityUsd < minLiquidityUsd) return null;
  if (volume24hUsd === null || volume24hUsd < minVolume24hUsd) return null;
  if (uniqueTraders24h === null || uniqueTraders24h < minUniqueTraders24h) return null;
  if (tradeCount24h === null || tradeCount24h < minTradeCount24h) return null;

  return (
    weights.volume * Math.log10(1 + Math.max(0, volume24hUsd)) +
    weights.uniqueTraders * Math.log10(1 + Math.max(0, uniqueTraders24h)) +
    weights.tradeCount * Math.log10(1 + Math.max(0, tradeCount24h))
  );
}

/** A trending result — the same market data `/market/discover` already serves, plus the
 *  distinct trending score that ordered it. Never conflated with `discoveryScore`: they're
 *  different formulas answering different questions (see the comment on
 *  `computeTrendingScore` above). */
export const TrendingTokenSchema = z.object({
  market: MarketSummarySchema,
  trendingScore: z.number(),
});
export type TrendingToken = z.infer<typeof TrendingTokenSchema>;
