import { z } from 'zod';

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/** True for a syntactically valid EVM address (0x + 40 hex chars) — format only, never
 *  proof of ownership or that the address has ever been used on-chain. */
export function isEvmAddress(address: string): boolean {
  return EVM_ADDRESS_PATTERN.test(address);
}

/** Canonical form used everywhere an address is stored or compared, so "0xABC…" and
 *  "0xabc…" are always the same wallet — see docs/SOCIAL.md#trader-identity. */
export function normalizeEvmAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * A wallet's public trading identity. Rows are created lazily by the ingestion worker the
 * first time an address is observed as a swap's trader — never by a user action. Not a
 * user account; see docs/WALLET_SECURITY.md's wallet-first identity model.
 */
export const WalletSchema = z.object({
  address: z.string().refine(isEvmAddress, 'not a valid EVM address'),
  displayName: z.string().min(1).nullable(),
  avatarUrl: z.string().url().nullable(),
  firstSeenAt: z.string().datetime(),
});
export type Wallet = z.infer<typeof WalletSchema>;

/**
 * Trading statistics computed directly from indexed `swaps` — only metrics that can be
 * computed correctly from what's actually indexed. Deliberately no profit/ROI/PnL/win
 * rate: Fomo doesn't track cost basis, so any of those would be fabricated. See
 * docs/SOCIAL.md#trader-stats and docs/TRADER_INTELLIGENCE.md (Phase 5) for the richer
 * fields added below and their exact formulas.
 */
export const TraderStatsSchema = z.object({
  totalSwaps: z.number().int().min(0),
  buyCount: z.number().int().min(0),
  sellCount: z.number().int().min(0),
  volumeUsd: z.number().min(0),
  firstSeenAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().nullable(),

  // Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-statistics for every formula. All
  // additive/nullable so this never breaks an existing consumer of TraderStats.
  /** Distinct token markets this wallet has traded, all-time. */
  uniqueTokensTraded: z.number().int().min(0),
  /** volumeUsd / totalSwaps — null (not 0) when totalSwaps is 0; an average of zero trades
   *  is undefined, not a real zero-sized average trade. */
  avgTradeSizeUsd: z.number().min(0).nullable(),
  /** The single largest confirmed trade by USD value, all-time. Null when totalSwaps is 0. */
  largestTradeUsd: z.number().min(0).nullable(),
  /** Trailing 24h volume — a real, possibly-zero recent figure once the wallet has traded
   *  at least once; never null just because nothing happened in the last 24h. */
  volume24hUsd: z.number().min(0),
  tradeCount24h: z.number().int().min(0),
  /** buyCount / totalSwaps, in [0, 1] — 1 means buy-only, 0 means sell-only. Null when
   *  totalSwaps is 0. */
  buyRatio: z.number().min(0).max(1).nullable(),
  /** Herfindahl-Hirschman-style concentration of volume across traded tokens, in (0, 1] —
   *  1 means all volume in a single token, closer to 0 means spread across many. Null when
   *  totalSwaps is 0. See computeConcentrationIndex in trader-intelligence.ts. */
  concentrationIndex: z.number().min(0).max(1).nullable(),
  /** totalSwaps / days-since-firstSeenAt (minimum 1 day) — trades per day, averaged over
   *  the wallet's whole tracked history. Null when totalSwaps is 0. */
  activityFrequencyPerDay: z.number().min(0).nullable(),
});
export type TraderStats = z.infer<typeof TraderStatsSchema>;

/**
 * A trader's public profile — the shape `/trader/[address]` and `GET
 * /social/traders/:address` both read. `isFollowedByMe` is `null` (not `false`) for an
 * unauthenticated caller: there is no "me" to check against, and `false` would misrepresent
 * that as a definite answer. See docs/SOCIAL.md#trader-identity.
 */
export const TraderProfileSchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  stats: TraderStatsSchema,
  followerCount: z.number().int().min(0),
  followingCount: z.number().int().min(0),
  isFollowedByMe: z.boolean().nullable(),
});
export type TraderProfile = z.infer<typeof TraderProfileSchema>;

/**
 * One row of the "Top Traders" ranking — ranked by real, measured 24h volume among traders
 * clearing a minimum trade-count floor (a single huge trade shouldn't win "most active" any
 * more than it should win trending — see TrendingService). Deliberately no "smart money" /
 * "profitable trader" claim: Fomo doesn't track cost basis, so it never labels anyone by
 * performance it can't compute. See docs/SOCIAL.md#trader-discovery.
 */
export const TopTraderSchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  volumeUsd: z.number(),
  tradeCount: z.number().int(),
});
export type TopTrader = z.infer<typeof TopTraderSchema>;
