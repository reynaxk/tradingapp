import type { SocialActivity, TopTrader, TraderProfile, TraderStats, TraderTokenStat } from '@fomo/domain';
import { computeActivityFrequencyPerDay, computeBuyRatio, computeConcentrationIndex } from '@fomo/domain';
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
      // Phase 3 — see docs/TRADING.md#quote-system. Lets an activity card's "Trade" action
      // request a quote directly, without a second round-trip to /market for token info.
      decimals: swap.tokenMarket.token.decimals,
      quoteAddress: swap.tokenMarket.quoteToken.contractAddress,
      quoteSymbol: swap.tokenMarket.quoteToken.symbol,
      quoteDecimals: swap.tokenMarket.quoteToken.decimals,
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

/**
 * Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-statistics for every formula. `perToken`
 * is the trader's volume grouped by tokenMarketId (for uniqueTokensTraded/concentration);
 * `recent24h`/`largest` are separate bounded aggregates TraderService gathers alongside the
 * base totals — see the query comments in getProfile for why each is its own query rather
 * than a single one Prisma can't express.
 */
export function toTraderStats(
  wallet: WalletRow,
  agg: { totalSwaps: number; buyCount: number; sellCount: number; volumeUsd: Prisma.Decimal | null },
  lastActiveAt: Date | null,
  extra: {
    perTokenVolumeUsd: number[];
    largestTradeUsd: Prisma.Decimal | null;
    recent24h: { tradeCount: number; volumeUsd: Prisma.Decimal | null };
  },
  now: Date = new Date(),
): TraderStats {
  const totalSwaps = agg.totalSwaps;
  const volumeUsd = agg.volumeUsd === null ? 0 : Number(agg.volumeUsd);

  return {
    totalSwaps,
    buyCount: agg.buyCount,
    sellCount: agg.sellCount,
    volumeUsd,
    firstSeenAt: wallet.firstSeenAt.toISOString(),
    lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,

    uniqueTokensTraded: extra.perTokenVolumeUsd.length,
    avgTradeSizeUsd: totalSwaps > 0 ? volumeUsd / totalSwaps : null,
    largestTradeUsd: extra.largestTradeUsd === null ? null : Number(extra.largestTradeUsd),
    volume24hUsd: extra.recent24h.volumeUsd === null ? 0 : Number(extra.recent24h.volumeUsd),
    tradeCount24h: extra.recent24h.tradeCount,
    buyRatio: computeBuyRatio(agg.buyCount, totalSwaps),
    concentrationIndex: computeConcentrationIndex(extra.perTokenVolumeUsd),
    activityFrequencyPerDay: computeActivityFrequencyPerDay(totalSwaps, wallet.firstSeenAt, now),
  };
}

export function toTraderTokenStat(
  tokenMarket: { token: { contractAddress: string; symbol: string | null; name: string | null; logoUrl: string | null } },
  tradeCount: number,
  volumeUsd: Prisma.Decimal | number,
  lastActivityAt: Date,
): TraderTokenStat {
  return {
    token: {
      address: tokenMarket.token.contractAddress,
      symbol: tokenMarket.token.symbol,
      name: tokenMarket.token.name,
      logoUrl: tokenMarket.token.logoUrl,
    },
    tradeCount,
    volumeUsd: Number(volumeUsd),
    lastActivityAt: lastActivityAt.toISOString(),
  };
}

export function toTopTrader(address: string, wallet: WalletRow | undefined, volumeUsd: number, tradeCount: number): TopTrader {
  return {
    address,
    displayName: wallet?.displayName ?? null,
    avatarUrl: wallet?.avatarUrl ?? null,
    volumeUsd,
    tradeCount,
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
