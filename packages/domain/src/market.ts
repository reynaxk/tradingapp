import { z } from 'zod';

/**
 * The chart/aggregation timeframes the history endpoint accepts. Each maps to a
 * `time_bucket` width applied to the raw 5-minute candles at query time — see
 * docs/MARKET_DATA.md for why buckets are aggregated on read rather than pre-materialized
 * per timeframe.
 */
export const TIMEFRAMES = ['1H', '4H', '1D', '1W', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const DiscoverSortSchema = z.enum(['score', 'volume', 'liquidity', 'priceChange']);
export type DiscoverSort = z.infer<typeof DiscoverSortSchema>;

/**
 * A token market as the API serves it — Token + TokenMarket joined, with Decimal/BigInt
 * fields normalized to plain numbers/strings for JSON. Nullable fields are nullable for a
 * reason (see field comments on TokenMarket in schema.prisma) — the web app must render an
 * honest empty/stale state for them, never a fabricated placeholder.
 */
export const MarketSummarySchema = z.object({
  chainIdentifier: z.string(),
  tokenAddress: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().int().nullable(),
  logoUrl: z.string().nullable(),
  quoteSymbol: z.string().nullable(),
  /** The quote token's own contract address/decimals — see docs/TRADING.md#quote-system.
   *  Added in Phase 3 so the web client can request a trade quote without a second
   *  round-trip; always present since every TokenMarket has a real quote token row. */
  quoteAddress: z.string(),
  quoteDecimals: z.number().int().nullable(),
  dex: z.string().nullable(),
  feeTier: z.number().int().nullable(),
  priceUsd: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  priceChange24hPct: z.number().nullable(),
  marketCapUsd: z.number().nullable(),
  lastPriceUpdateAt: z.string().datetime().nullable(),
  /** True when lastPriceUpdateAt is older than the staleness window — see docs/MARKET_DATA.md. */
  isStale: z.boolean(),
  /** Present only on /market/discover — the transparent ranking score, see docs/MARKET_DATA.md. */
  discoveryScore: z.number().nullable().optional(),
});
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

export const CandleSchema = z.object({
  bucketStart: z.string().datetime(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volumeUsd: z.number(),
});
export type Candle = z.infer<typeof CandleSchema>;

/**
 * Ranking weights and gates for /market/discover. Documented, not a black box — see
 * docs/MARKET_DATA.md#ranking for the formula these feed. Exported from here so the API
 * service and the documentation are guaranteed to describe the same numbers.
 */
export const DISCOVERY_RANKING = {
  weights: { volume: 0.4, momentum: 0.3, liquidity: 0.3 },
  /** A market below this liquidity is excluded from ranked results entirely. */
  minLiquidityUsd: 10_000,
  /** A price snapshot older than this is treated as stale and excluded from ranking. */
  maxStalenessMinutes: 30,
  /** Momentum's raw input is clamped to +/- this before weighting, so a huge percentage
   *  swing on a near-zero denominator can't dominate the score. */
  momentumClampPct: 50,
} as const;

/**
 * Discovery Score = w_volume * log10(1 + volume24h) + w_momentum * clamp(change24h) +
 * w_liquidity * log10(1 + liquidity) — see docs/MARKET_DATA.md#ranking for the full
 * rationale. Log-scaling volume/liquidity keeps one whale market from mathematically
 * dominating every other factor; clamping momentum keeps a tiny-denominator percentage
 * spike from doing the same. Returns null for a market this formula shouldn't rank at all
 * (below the liquidity gate, missing the inputs it needs, or stale — see
 * DISCOVERY_RANKING.maxStalenessMinutes) rather than a misleading 0 or a ranking built on
 * a snapshot that's no longer current.
 */
export function computeDiscoveryScore(
  input: {
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    priceChange24hPct: number | null;
    lastPriceUpdateAt: Date | string | null;
  },
  now: Date = new Date(),
): number | null {
  const { volume24hUsd, liquidityUsd, priceChange24hPct, lastPriceUpdateAt } = input;
  if (isPriceStale(lastPriceUpdateAt, now)) return null;
  if (liquidityUsd === null || liquidityUsd < DISCOVERY_RANKING.minLiquidityUsd) return null;
  if (volume24hUsd === null || priceChange24hPct === null) return null;

  const { weights, momentumClampPct } = DISCOVERY_RANKING;
  const clampedMomentum = Math.max(-momentumClampPct, Math.min(momentumClampPct, priceChange24hPct));

  return (
    weights.volume * Math.log10(1 + Math.max(0, volume24hUsd)) +
    weights.momentum * clampedMomentum +
    weights.liquidity * Math.log10(1 + Math.max(0, liquidityUsd))
  );
}

/** A price snapshot is stale once it's older than the configured window — see the "Stale" UI state in docs/MARKET_DATA.md. */
export function isPriceStale(lastPriceUpdateAt: Date | string | null, now: Date = new Date()): boolean {
  if (lastPriceUpdateAt === null) return true;
  const last = typeof lastPriceUpdateAt === 'string' ? new Date(lastPriceUpdateAt) : lastPriceUpdateAt;
  const ageMinutes = (now.getTime() - last.getTime()) / 60_000;
  // A negative age means lastPriceUpdateAt is in the future — clock skew or bad data, never
  // a legitimately "fresher than fresh" snapshot. Treat it defensively as stale rather than
  // let it read as the most current price on record.
  if (ageMinutes < 0) return true;
  return ageMinutes > DISCOVERY_RANKING.maxStalenessMinutes;
}
