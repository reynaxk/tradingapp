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
 * docs/SOCIAL.md#trader-stats.
 */
export const TraderStatsSchema = z.object({
  totalSwaps: z.number().int().min(0),
  buyCount: z.number().int().min(0),
  sellCount: z.number().int().min(0),
  volumeUsd: z.number().min(0),
  firstSeenAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().nullable(),
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
