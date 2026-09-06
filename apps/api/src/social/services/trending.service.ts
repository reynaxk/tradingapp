import { Injectable } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { computeTrendingScore, type TrendingToken } from '@fomo/domain';
import { toMarketSummary, type MarketRow } from '../../market/market.mapper';

const toNumber = (value: MarketRow['liquidityUsd']): number | null => (value === null ? null : Number(value));

/**
 * Ranks tracked markets by real trading *activity* (unique traders + trade count +
 * volume), not raw volume alone — see `computeTrendingScore` in packages/domain/src/social.ts
 * for the full formula and gating thresholds. Application-code sort over one bounded fetch,
 * same documented tradeoff as `MarketService#discover` at Phase 1/2's tracked-market count.
 */
@Injectable()
export class TrendingService {
  async getTrending(limit: number): Promise<TrendingToken[]> {
    const markets = await prisma.tokenMarket.findMany({ include: { token: true, quoteToken: true, chain: true } });

    const scored = markets
      .map((row) => ({
        row,
        score: computeTrendingScore({
          volume24hUsd: toNumber(row.volume24hUsd),
          liquidityUsd: toNumber(row.liquidityUsd),
          uniqueTraders24h: row.uniqueTraders24h,
          tradeCount24h: row.tradeCount24h,
        }),
      }))
      .filter((entry): entry is { row: MarketRow; score: number } => entry.score !== null);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ row, score }) => ({ market: toMarketSummary(row), trendingScore: score }));
  }
}
