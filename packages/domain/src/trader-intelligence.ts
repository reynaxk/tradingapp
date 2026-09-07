import { z } from 'zod';
import { MarketSummarySchema } from './market';
import { NOTIFICATION_DEFAULTS } from './notifications';
import { SocialActivitySchema } from './social';

/**
 * Phase 5 domain — trader intelligence, discovery rankings, and personalization. Pure
 * logic and Zod schemas only (no I/O, matching every other file in this package). See
 * docs/TRADER_INTELLIGENCE.md for the full methodology writeup; every constant and formula
 * below is documented there in one place so a ranking is never a black box.
 *
 * Hard rule carried from the spec: never fabricate a financial performance metric.
 * Everything here is derived from indexed `swaps` (and the viewer's own follows/likes/
 * trades) — nothing here computes or implies PnL, ROI, win rate, or "smart money." See
 * docs/TRADER_INTELLIGENCE.md#deferred-metrics for exactly why those are out of scope
 * until Fomo's data model can support them correctly.
 */

// ---------------------------------------------------------------------------------------
// Shared thresholds — centralized so no ranking redefines "large trade" or "active enough"
// independently. Reused, not reimplemented, from wherever an equivalent concept already
// exists elsewhere in the codebase.
// ---------------------------------------------------------------------------------------

/** What counts as a "large trade" for discovery — the exact same figure Phase 4's whale-
 *  trade notifications use (`NOTIFICATION_DEFAULTS.whaleTradeUsdThreshold`), so "large" never
 *  means two different things in two different parts of the product. */
export const LARGE_TRADE_USD_THRESHOLD = NOTIFICATION_DEFAULTS.whaleTradeUsdThreshold;

/** A wallet needs at least this many trades in a ranking window to appear in *any*
 *  trade-count-floored trader ranking (Top Traders, Active Traders) — one huge or one-off
 *  trade shouldn't win a ranking that's supposed to mean "consistently active." */
export const MIN_TRADES_FOR_TRADER_RANKING = 2;

/** A token counts as "Rising" if it entered trending (see TokenTrendingState in
 *  schema.prisma) within this many hours — reusing Phase 4's own trending-transition state
 *  rather than inventing a second momentum metric. */
export const RISING_TOKEN_WINDOW_HOURS = 24;

export const RISING_TRADER_CONFIG = {
  /** Today's trade count must be at least this many times the wallet's own all-time daily
   *  average to count as "rising" — a real, computable comparison against the wallet's own
   *  history, not an arbitrary absolute count. */
  multiplier: 2,
  /** Never call a wallet "rising" off a trivial trade count, same reasoning as
   *  MIN_TRADES_FOR_TRADER_RANKING. */
  minTradeCount24h: 3,
} as const;

/** How many hours of Redis cache-aside TTL a public discovery ranking gets — see
 *  docs/TRADER_INTELLIGENCE.md#caching. Short enough that a burst of new activity is
 *  reflected quickly; long enough to absorb a page of anonymous discover-page traffic
 *  without re-running the underlying aggregation on every request. */
export const DISCOVERY_CACHE_TTL_SECONDS = 30;

// ---------------------------------------------------------------------------------------
// Trader statistics — pure formulas over data the caller has already aggregated (via SQL
// GROUP BY, never a per-row loop in application code — see docs/TRADER_INTELLIGENCE.md#performance).
// ---------------------------------------------------------------------------------------

/** buyCount / totalSwaps, in [0, 1]. Null (not 0 or 1) when there are no trades to ratio at all. */
export function computeBuyRatio(buyCount: number, totalSwaps: number): number | null {
  if (totalSwaps <= 0) return null;
  return buyCount / totalSwaps;
}

/**
 * Herfindahl-Hirschman-style concentration of volume across the tokens a wallet has
 * traded: sum((tokenVolume / totalVolume)^2) — a standard, well-known concentration
 * formula (the same one used broadly in economics for market concentration), not an
 * invented metric. Close to 0 means volume spread evenly across many tokens; 1 means every
 * dollar went through a single token. Null when there's no measurable volume at all.
 */
export function computeConcentrationIndex(volumesByToken: number[]): number | null {
  const total = volumesByToken.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return null;
  return volumesByToken.reduce((sum, v) => sum + (Math.max(0, v) / total) ** 2, 0);
}

/** totalSwaps / days-since-firstSeenAt (minimum 1 day, so a wallet seen minutes ago
 *  doesn't produce a huge, meaningless rate). Null when the wallet has never traded. */
export function computeActivityFrequencyPerDay(
  totalSwaps: number,
  firstSeenAt: Date | string,
  now: Date = new Date(),
): number | null {
  if (totalSwaps <= 0) return null;
  const first = typeof firstSeenAt === 'string' ? new Date(firstSeenAt) : firstSeenAt;
  const days = Math.max(1, (now.getTime() - first.getTime()) / 86_400_000);
  return totalSwaps / days;
}

// ---------------------------------------------------------------------------------------
// "Rising" — a measurable increase in activity, never a vibe. See the RISING_* config above.
// ---------------------------------------------------------------------------------------

/** A token is "Rising" exactly when it transitioned into trending within the configured
 *  window — reuses Phase 4's TokenTrendingState.becameTrendingAt directly. */
export function isRecentlyRisingToken(
  becameTrendingAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (becameTrendingAt === null) return false;
  const at = typeof becameTrendingAt === 'string' ? new Date(becameTrendingAt) : becameTrendingAt;
  const hours = (now.getTime() - at.getTime()) / 3_600_000;
  return hours >= 0 && hours <= RISING_TOKEN_WINDOW_HOURS;
}

/** A wallet is "Rising" when today's trade count both clears an absolute floor and is a
 *  multiple of that wallet's own all-time daily average — genuinely trading above their
 *  usual pace, not just "had a few trades today." */
export function isRisingTrader(input: {
  tradeCount24h: number;
  totalSwaps: number;
  firstSeenAt: Date | string;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  if (input.tradeCount24h < RISING_TRADER_CONFIG.minTradeCount24h) return false;
  const freq = computeActivityFrequencyPerDay(input.totalSwaps, input.firstSeenAt, now);
  if (freq === null) return false;
  return input.tradeCount24h >= freq * RISING_TRADER_CONFIG.multiplier;
}

// ---------------------------------------------------------------------------------------
// Personalized discovery scoring — see docs/TRADER_INTELLIGENCE.md#personalization for the
// full rationale behind each weight. Deterministic, bounded (every term is either a fixed
// weight or a log/linearly-scaled bounded quantity — nothing here can grow unboundedly),
// and testable in isolation from any database.
// ---------------------------------------------------------------------------------------

export const PERSONALIZATION_WEIGHTS = {
  /** The token's own objective, already-bounded discovery score (see computeDiscoveryScore
   *  in market.ts) — reused directly, never recomputed. */
  marketActivity: 0.3,
  /** A trader the viewer follows traded this token within FOLLOWED_TRADER_SIGNAL_WINDOW_HOURS. */
  followedTrader: 0.3,
  /** The viewer has personally traded this token before (any confirmed Fomo trade). */
  tradingInterest: 0.2,
  /** The viewer has liked activity involving this token — log-scaled so a handful of likes
   *  can't dominate the score the way raw volume/liquidity can't in computeDiscoveryScore. */
  engagement: 0.1,
  /** How fresh the most relevant signal is — decays linearly to 0 over RECENCY_WINDOW_HOURS. */
  recency: 0.1,
  /** Phase 6 — the viewer has this token on their watchlist (see TokenWatch). Added on top
   *  of the five Phase 5 weights above without rebalancing them, so a non-watched token's
   *  score is completely unchanged from Phase 5 — see docs/PHASE6_RETENTION_SOCIAL.md#personalization.
   *  Deliberately NOT the largest weight: "watchlist ≠ automatic top ranking" per spec, so a
   *  single watched token can nudge the feed without being able to dominate it outright
   *  (marketActivity + followedTrader alone already outweigh it). */
  watchlist: 0.25,
} as const;

/** The window a "followed trader traded this" signal stays fresh for — matches
 *  TokenMarket's own 24h convention used throughout the rest of the product. */
export const FOLLOWED_TRADER_SIGNAL_WINDOW_HOURS = 24;

/** How many hours the recency term takes to fully decay to 0. */
export const RECENCY_WINDOW_HOURS = 72;

export interface PersonalizationSignals {
  /** computeDiscoveryScore's own output for this token — candidates are always pre-gated
   *  to tokens where this isn't null (see DiscoveryService#personalizedDiscovery). */
  marketActivityScore: number;
  /** Display label of a followed trader who traded this token recently, resolved by the
   *  caller — null if none. Non-null is what makes the followedTrader weight apply. */
  followedTraderLabel: string | null;
  viewerHasTraded: boolean;
  viewerLikeCount: number;
  /** Hours since the most relevant signal (a followed-trader trade, or the token's own
   *  last price update) — null when no timestamp is available, contributing no recency
   *  boost rather than a guessed one. */
  hoursSinceRelevantActivity: number | null;
  /** Phase 6 — the viewer has this token on their watchlist. See PERSONALIZATION_WEIGHTS.watchlist. */
  isWatched: boolean;
}

/** Sum of five independently-bounded weighted terms — see PERSONALIZATION_WEIGHTS above
 *  for what each one means and docs/TRADER_INTELLIGENCE.md for the full formula. */
export function computePersonalizationScore(signals: PersonalizationSignals): number {
  const w = PERSONALIZATION_WEIGHTS;
  const marketActivity = w.marketActivity * signals.marketActivityScore;
  const followedTrader = signals.followedTraderLabel !== null ? w.followedTrader : 0;
  const tradingInterest = signals.viewerHasTraded ? w.tradingInterest : 0;
  const engagement = w.engagement * Math.log10(1 + Math.max(0, signals.viewerLikeCount));
  const recency =
    signals.hoursSinceRelevantActivity === null
      ? 0
      : w.recency * Math.max(0, 1 - signals.hoursSinceRelevantActivity / RECENCY_WINDOW_HOURS);
  const watchlist = signals.isWatched ? w.watchlist : 0;

  return marketActivity + followedTrader + tradingInterest + engagement + recency + watchlist;
}

/** Plain-language reasons for a personalized discovery item — every reason maps directly
 *  to a signal that actually fired, never an unexplained label like "AI picked" or "alpha".
 *  Always returns at least one reason (falls back to the objective market-activity signal). */
export function buildPersonalizationReasons(signals: PersonalizationSignals): string[] {
  const reasons: string[] = [];
  if (signals.followedTraderLabel !== null)
    reasons.push(`${signals.followedTraderLabel} traded this recently`);
  if (signals.viewerHasTraded) reasons.push("You've traded this before");
  if (signals.viewerLikeCount > 0) reasons.push('You liked related activity');
  if (signals.isWatched) reasons.push("You're watching this token");
  if (reasons.length === 0) reasons.push('Active on the market');
  return reasons;
}

export type FeedReasonCode = 'FOLLOWED_TRADER' | 'GENERAL_DISCOVERY';

/** Reason text for one item in the personalized activity feed — see
 *  docs/TRADER_INTELLIGENCE.md#personalized-feed for why this feed is a union (followed
 *  traders + general discovery) rather than a scored re-ranking. */
export function feedReasonText(code: FeedReasonCode, traderLabel: string | null): string {
  if (code === 'FOLLOWED_TRADER')
    return traderLabel ? `Because you follow ${traderLabel}` : 'From a trader you follow';
  return 'Active on the market';
}

// ---------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------

/** One token a trader has traded, aggregated — see docs/TRADER_INTELLIGENCE.md#trader-to-token. */
export const TraderTokenStatSchema = z.object({
  token: z.object({
    address: z.string(),
    symbol: z.string().nullable(),
    name: z.string().nullable(),
    logoUrl: z.string().nullable(),
  }),
  tradeCount: z.number().int().min(0),
  volumeUsd: z.number().min(0),
  lastActivityAt: z.string().datetime(),
});
export type TraderTokenStat = z.infer<typeof TraderTokenStatSchema>;

/** One trader active on a specific token — see docs/TRADER_INTELLIGENCE.md#token-to-trader.
 *  `tradeCount24h` is null for a plain "recently active" listing where that count isn't
 *  computed (see TokenTraderConnection.recentTraders) — never a misleading 0. */
export const TokenTraderSchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  lastTradeAt: z.string().datetime(),
  tradeCount24h: z.number().int().min(0).nullable(),
});
export type TokenTrader = z.infer<typeof TokenTraderSchema>;

export const TokenTraderConnectionSchema = z.object({
  /** Reused directly from TokenMarket.uniqueTraders24h — never recomputed. Null until this
   *  market has ever had a swap indexed, same nullability rule as the column itself. */
  uniqueTraders24h: z.number().int().min(0).nullable(),
  recentTraders: z.array(TokenTraderSchema),
  activeTraders: z.array(TokenTraderSchema),
  recentLargeTrades: z.array(SocialActivitySchema),
  /** Phase 6 — aggregate count of `TokenWatch` rows for this market only (a single-token
   *  detail-page context, unlike bulk `MarketSummary` list views, which never carry this to
   *  keep discover/search pages to one cheap query). Never reveals which users are watching
   *  — see docs/PHASE6_RETENTION_SOCIAL.md#social-proof. */
  watcherCount: z.number().int().min(0),
});
export type TokenTraderConnection = z.infer<typeof TokenTraderConnectionSchema>;

export const RisingTokenSchema = z.object({
  market: MarketSummarySchema,
  becameTrendingAt: z.string().datetime(),
});
export type RisingToken = z.infer<typeof RisingTokenSchema>;

export const RisingTraderSchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tradeCount24h: z.number().int().min(0),
  activityFrequencyPerDay: z.number().min(0),
});
export type RisingTrader = z.infer<typeof RisingTraderSchema>;

export const PersonalizedTokenSchema = z.object({
  market: MarketSummarySchema,
  score: z.number(),
  reasons: z.array(z.string()).min(1),
});
export type PersonalizedToken = z.infer<typeof PersonalizedTokenSchema>;

export const PersonalizedFeedItemSchema = z.object({
  activity: SocialActivitySchema,
  reasonCode: z.enum(['FOLLOWED_TRADER', 'GENERAL_DISCOVERY']),
  reason: z.string(),
});
export type PersonalizedFeedItem = z.infer<typeof PersonalizedFeedItemSchema>;

export const PersonalizedFeedPageSchema = z.object({
  items: z.array(PersonalizedFeedItemSchema),
  nextCursor: z.string().nullable(),
});
export type PersonalizedFeedPage = z.infer<typeof PersonalizedFeedPageSchema>;
