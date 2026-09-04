import type { MarketSummary } from '@fomo/domain';
import { isPriceStale } from '@fomo/domain';
import type { Prisma } from '@fomo/db';

export type MarketRow = Prisma.TokenMarketGetPayload<{
  include: { token: true; quoteToken: true; chain: true };
}>;

const toNumber = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

/** The one place a raw DB row becomes the shape the web app reads — Decimal/BigInt
 *  normalized to JSON-safe numbers, staleness computed, nothing fabricated. */
export function toMarketSummary(row: MarketRow, discoveryScore?: number | null): MarketSummary {
  return {
    chainIdentifier: row.chain.identifier,
    tokenAddress: row.token.contractAddress,
    symbol: row.token.symbol,
    name: row.token.name,
    decimals: row.token.decimals,
    logoUrl: row.token.logoUrl,
    quoteSymbol: row.quoteToken.symbol,
    dex: row.dex,
    feeTier: row.feeTier,
    priceUsd: toNumber(row.priceUsd),
    liquidityUsd: toNumber(row.liquidityUsd),
    volume24hUsd: toNumber(row.volume24hUsd),
    priceChange24hPct: toNumber(row.priceChange24hPct),
    marketCapUsd: toNumber(row.marketCapUsd),
    lastPriceUpdateAt: row.lastPriceUpdateAt ? row.lastPriceUpdateAt.toISOString() : null,
    isStale: isPriceStale(row.lastPriceUpdateAt),
    ...(discoveryScore !== undefined ? { discoveryScore } : {}),
  };
}
