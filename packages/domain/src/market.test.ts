import { describe, expect, it } from 'vitest';
import { computeDiscoveryScore, DISCOVERY_RANKING, isPriceStale } from './market';

describe('computeDiscoveryScore', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const fresh = new Date(now.getTime() - 5 * 60_000); // well within the staleness window

  it('ranks a high-volume, high-liquidity market above a quiet one', () => {
    const hot = computeDiscoveryScore(
      { volume24hUsd: 5_000_000, liquidityUsd: 2_000_000, priceChange24hPct: 12, lastPriceUpdateAt: fresh },
      now,
    );
    const quiet = computeDiscoveryScore(
      { volume24hUsd: 20_000, liquidityUsd: 50_000, priceChange24hPct: 1, lastPriceUpdateAt: fresh },
      now,
    );
    expect(hot).not.toBeNull();
    expect(quiet).not.toBeNull();
    expect(hot!).toBeGreaterThan(quiet!);
  });

  it('excludes a market below the minimum liquidity gate, rather than scoring it low', () => {
    const score = computeDiscoveryScore(
      {
        volume24hUsd: 1_000_000,
        liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd - 1,
        priceChange24hPct: 5,
        lastPriceUpdateAt: fresh,
      },
      now,
    );
    expect(score).toBeNull();
  });

  it('excludes a stale market from ranking, even with strong volume/liquidity/momentum', () => {
    const stale = new Date(now.getTime() - (DISCOVERY_RANKING.maxStalenessMinutes + 1) * 60_000);
    const score = computeDiscoveryScore(
      { volume24hUsd: 5_000_000, liquidityUsd: 2_000_000, priceChange24hPct: 12, lastPriceUpdateAt: stale },
      now,
    );
    expect(score).toBeNull();
  });

  it('excludes a market with no price snapshot at all (null lastPriceUpdateAt) from ranking', () => {
    const score = computeDiscoveryScore(
      { volume24hUsd: 5_000_000, liquidityUsd: 2_000_000, priceChange24hPct: 12, lastPriceUpdateAt: null },
      now,
    );
    expect(score).toBeNull();
  });

  it('does not let an absurd percentage swing on a tiny denominator dominate the score', () => {
    // A move right at the clamp ceiling on real volume/liquidity...
    const atCeiling = computeDiscoveryScore(
      {
        volume24hUsd: 100_000,
        liquidityUsd: 100_000,
        priceChange24hPct: DISCOVERY_RANKING.momentumClampPct,
        lastPriceUpdateAt: fresh,
      },
      now,
    );
    // ...vs a +5000% move (thin-book artifact) on the same volume/liquidity — an
    // unclamped formula would score this 100x higher on the momentum term alone.
    const absurd = computeDiscoveryScore(
      { volume24hUsd: 100_000, liquidityUsd: 100_000, priceChange24hPct: 5000, lastPriceUpdateAt: fresh },
      now,
    );
    expect(atCeiling).not.toBeNull();
    expect(absurd).not.toBeNull();
    // Both clamp to the same momentum ceiling, so the scores should be identical.
    expect(absurd).toBeCloseTo(atCeiling!, 6);
  });

  it('returns null instead of a misleading zero when volume/change data is missing', () => {
    expect(
      computeDiscoveryScore(
        { volume24hUsd: null, liquidityUsd: 1_000_000, priceChange24hPct: 5, lastPriceUpdateAt: fresh },
        now,
      ),
    ).toBeNull();
    expect(
      computeDiscoveryScore(
        { volume24hUsd: 1000, liquidityUsd: 1_000_000, priceChange24hPct: null, lastPriceUpdateAt: fresh },
        now,
      ),
    ).toBeNull();
  });
});

describe('isPriceStale', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('treats a null timestamp as stale', () => {
    expect(isPriceStale(null, now)).toBe(true);
  });

  it('treats a recent update as fresh', () => {
    const recent = new Date(now.getTime() - 5 * 60_000);
    expect(isPriceStale(recent, now)).toBe(false);
  });

  it('treats an update past the staleness window as stale', () => {
    const old = new Date(now.getTime() - (DISCOVERY_RANKING.maxStalenessMinutes + 1) * 60_000);
    expect(isPriceStale(old, now)).toBe(true);
  });
});
