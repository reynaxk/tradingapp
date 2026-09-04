import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { CandleSchema, computeDiscoveryScore, type Candle, type MarketSummary, type Timeframe } from '@fomo/domain';
import type { DiscoverQueryDto } from './dto/discover-query.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import { toMarketSummary, type MarketRow } from './market.mapper';

const MARKET_INCLUDE = { token: true, quoteToken: true, chain: true } as const;

/** bucket width and lookback window per chart timeframe — see docs/MARKET_DATA.md#timeframes. */
const TIMEFRAME_CONFIG: Record<Timeframe, { bucket: string; lookback: string }> = {
  '1H': { bucket: '5 minutes', lookback: '1 hour' },
  '4H': { bucket: '15 minutes', lookback: '4 hours' },
  '1D': { bucket: '1 hour', lookback: '1 day' },
  '1W': { bucket: '4 hours', lookback: '7 days' },
  '1M': { bucket: '1 day', lookback: '30 days' },
};

@Injectable()
export class MarketService {
  /**
   * Ranked market opportunities. Phase 1's market count is small and bounded by design
   * (see docs/MARKET_DATA.md#token-discovery), so scoring/sorting happens in application
   * code after one bounded fetch — the honest, simple choice at this scale. Moving ranking
   * into a SQL-computed view (or a materialized, indexed score column) is the documented
   * next step once the tracked-market count stops being small.
   */
  async discover(query: DiscoverQueryDto): Promise<MarketSummary[]> {
    const rows = await prisma.tokenMarket.findMany({ include: MARKET_INCLUDE });
    const filtered = query.search ? rows.filter((row) => matchesSearch(row, query.search!)) : rows;

    const scored = filtered
      .map((row) => ({
        row,
        score: computeDiscoveryScore({
          volume24hUsd: row.volume24hUsd === null ? null : Number(row.volume24hUsd),
          liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
          priceChange24hPct: row.priceChange24hPct === null ? null : Number(row.priceChange24hPct),
        }),
      }))
      .filter((entry): entry is { row: MarketRow; score: number } => entry.score !== null);

    scored.sort((a, b) => compareBySort(a, b, query.sort));

    return scored.slice(0, query.limit).map(({ row, score }) => toMarketSummary(row, score));
  }

  async getToken(address: string): Promise<MarketSummary> {
    assertAddressShape(address);
    const row = await prisma.tokenMarket.findFirst({
      where: { token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      include: MARKET_INCLUDE,
      orderBy: { liquidityUsd: 'desc' },
    });
    if (!row) throw new NotFoundException(`No tracked market for token address "${address}"`);
    return toMarketSummary(row);
  }

  async getHistory(address: string, timeframe: Timeframe): Promise<Candle[]> {
    assertAddressShape(address);
    const market = await prisma.tokenMarket.findFirst({
      where: { token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      orderBy: { liquidityUsd: 'desc' },
    });
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);

    const { bucket, lookback } = TIMEFRAME_CONFIG[timeframe];
    const rows = await prisma.$queryRaw<
      { bucket_start: Date; open: unknown; high: unknown; low: unknown; close: unknown; volume_usd: unknown }[]
    >`
      SELECT
        time_bucket(${bucket}::interval, bucket_start) AS bucket_start,
        (array_agg(open ORDER BY bucket_start ASC))[1] AS open,
        MAX(high) AS high,
        MIN(low) AS low,
        (array_agg(close ORDER BY bucket_start DESC))[1] AS close,
        SUM(volume_usd) AS volume_usd
      FROM candles
      WHERE token_market_id = ${market.id}::text
        AND bucket_start >= NOW() - ${lookback}::interval
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((r) =>
      CandleSchema.parse({
        bucketStart: r.bucket_start.toISOString(),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volumeUsd: Number(r.volume_usd),
      }),
    );
  }

  async search(query: SearchQueryDto): Promise<MarketSummary[]> {
    const rows = await prisma.tokenMarket.findMany({
      where: {
        OR: [
          { token: { symbol: { contains: query.q, mode: 'insensitive' } } },
          { token: { name: { contains: query.q, mode: 'insensitive' } } },
          { token: { contractAddress: { equals: query.q, mode: 'insensitive' } } },
        ],
      },
      include: MARKET_INCLUDE,
      orderBy: { liquidityUsd: 'desc' },
      take: query.limit,
    });
    return rows.map((row) => toMarketSummary(row));
  }
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function assertAddressShape(address: string): void {
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new BadRequestException(`"${address}" is not a valid contract address`);
  }
}

function matchesSearch(row: MarketRow, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    (row.token.symbol?.toLowerCase().includes(needle) ?? false) ||
    (row.token.name?.toLowerCase().includes(needle) ?? false) ||
    row.token.contractAddress.toLowerCase() === needle
  );
}

function compareBySort(
  a: { row: MarketRow; score: number },
  b: { row: MarketRow; score: number },
  sort: DiscoverQueryDto['sort'],
): number {
  switch (sort) {
    case 'volume':
      return numDesc(a.row.volume24hUsd, b.row.volume24hUsd);
    case 'liquidity':
      return numDesc(a.row.liquidityUsd, b.row.liquidityUsd);
    case 'priceChange':
      return numDesc(a.row.priceChange24hPct, b.row.priceChange24hPct);
    case 'score':
    default:
      return b.score - a.score;
  }
}

function numDesc(a: { toNumber(): number } | null, b: { toNumber(): number } | null): number {
  const an = a === null ? -Infinity : a.toNumber();
  const bn = b === null ? -Infinity : b.toNumber();
  return bn - an;
}
