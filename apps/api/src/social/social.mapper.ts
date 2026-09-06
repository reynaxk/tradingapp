import type { SocialActivity, TraderProfile, TraderStats } from '@fomo/domain';
import type { Prisma } from '@fomo/db';

export type ActivityRow = Prisma.SwapGetPayload<{
  include: { tokenMarket: { include: { token: true; quoteToken: true; chain: true } }; trader: true };
}>;

/**
 * The one place a raw `swaps` row (joined with its market/token/trader) becomes the social
 * activity shape the feed API serves — see the "Activity model" section of docs/SOCIAL.md.
 * `likes`/`likedByMe` are passed in rather than queried per-row so callers can batch them
 * (see ActivityService) instead of causing an N+1 query per feed page.
 */
export function toSocialActivity(swap: ActivityRow, likes: number, likedByMe: boolean | null): SocialActivity {
  const priceUsd = Number(swap.priceUsd);
  const amountUsd = Number(swap.volumeUsd);
  return {
    id: swap.id,
    chainIdentifier: swap.tokenMarket.chain.identifier,
    trader: {
      address: swap.traderAddress,
      displayName: swap.trader?.displayName ?? null,
      avatarUrl: swap.trader?.avatarUrl ?? null,
    },
    action: swap.side === 'buy' ? 'BUY' : 'SELL',
    token: {
      address: swap.tokenMarket.token.contractAddress,
      symbol: swap.tokenMarket.token.symbol,
      name: swap.tokenMarket.token.name,
      logoUrl: swap.tokenMarket.token.logoUrl,
    },
    amountUsd,
    // priceUsd is always > 0 for a stored swap (DB column is non-nullable, never zero by
    // construction — see ingestion.ts), so this recovers the base-token quantity exactly
    // as it was computed at ingestion time without a separate stored column.
    tokenAmount: priceUsd > 0 ? amountUsd / priceUsd : 0,
    priceUsd,
    timestamp: swap.blockTimestamp.toISOString(),
    txHash: swap.txHash,
    chainId: swap.chainId,
    social: { likes, likedByMe },
  };
}

export type WalletRow = Prisma.WalletGetPayload<Record<string, never>>;

/** A lightweight trader identity for search results and follow/following lists — never the
 *  full profile (that requires a stats aggregate this shape deliberately avoids). */
export function toTraderSummary(wallet: WalletRow): { address: string; displayName: string | null; avatarUrl: string | null } {
  return { address: wallet.address, displayName: wallet.displayName, avatarUrl: wallet.avatarUrl };
}

export function toTraderStats(
  wallet: WalletRow,
  agg: { totalSwaps: number; buyCount: number; sellCount: number; volumeUsd: Prisma.Decimal | null },
  lastActiveAt: Date | null,
): TraderStats {
  return {
    totalSwaps: agg.totalSwaps,
    buyCount: agg.buyCount,
    sellCount: agg.sellCount,
    volumeUsd: agg.volumeUsd === null ? 0 : Number(agg.volumeUsd),
    firstSeenAt: wallet.firstSeenAt.toISOString(),
    lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
  };
}

export function toTraderProfile(
  wallet: WalletRow,
  stats: TraderStats,
  followerCount: number,
  followingCount: number,
  isFollowedByMe: boolean | null,
): TraderProfile {
  return {
    address: wallet.address,
    displayName: wallet.displayName,
    avatarUrl: wallet.avatarUrl,
    stats,
    followerCount,
    followingCount,
    isFollowedByMe,
  };
}
