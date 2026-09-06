import { describe, expect, it } from 'vitest';
import {
  ActivityCursorSchema,
  computeTrendingScore,
  decodeActivityCursor,
  encodeActivityCursor,
  TRENDING_RANKING,
} from './social';

describe('activity cursor', () => {
  const cursor = { blockTimestamp: '2026-01-01T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' };

  it('round-trips a valid cursor through encode/decode', () => {
    const encoded = encodeActivityCursor(cursor);
    expect(decodeActivityCursor(encoded)).toEqual(cursor);
  });

  it('produces a URL-safe, opaque string (no raw JSON, no offset-shaped content)', () => {
    const encoded = encodeActivityCursor(cursor);
    expect(encoded).not.toMatch(/[+/=]/); // base64url, not base64
    expect(encoded).not.toContain('blockTimestamp');
  });

  it('returns null for a cursor that is not valid base64url', () => {
    expect(decodeActivityCursor('%%%not-base64%%%')).toBeNull();
  });

  it('returns null for a cursor that decodes to something other than JSON', () => {
    const garbage = Buffer.from('not json at all', 'utf8').toString('base64url');
    expect(decodeActivityCursor(garbage)).toBeNull();
  });

  it('returns null for well-formed JSON missing the required shape', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeActivityCursor(wrongShape)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeActivityCursor('')).toBeNull();
  });

  it('the schema itself rejects a non-uuid id', () => {
    const result = ActivityCursorSchema.safeParse({ blockTimestamp: cursor.blockTimestamp, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('computeTrendingScore', () => {
  const healthy = {
    volume24hUsd: 50_000,
    liquidityUsd: 100_000,
    uniqueTraders24h: 20,
    tradeCount24h: 40,
  };

  it('scores a market that clears every threshold', () => {
    expect(computeTrendingScore(healthy)).not.toBeNull();
  });

  it('excludes a market below the minimum liquidity gate, even with heavy activity', () => {
    const score = computeTrendingScore({
      ...healthy,
      liquidityUsd: TRENDING_RANKING.minLiquidityUsd - 1,
    });
    expect(score).toBeNull();
  });

  it('excludes a market below the minimum unique-trader gate — a single whale can\'t trend it', () => {
    const score = computeTrendingScore({
      ...healthy,
      volume24hUsd: 1_000_000, // huge volume from...
      uniqueTraders24h: 1, // ...one trader alone
    });
    expect(score).toBeNull();
  });

  it('excludes a market below the minimum trade-count gate', () => {
    const score = computeTrendingScore({ ...healthy, tradeCount24h: TRENDING_RANKING.minTradeCount24h - 1 });
    expect(score).toBeNull();
  });

  it('excludes a market below the minimum volume gate', () => {
    const score = computeTrendingScore({ ...healthy, volume24hUsd: TRENDING_RANKING.minVolume24hUsd - 1 });
    expect(score).toBeNull();
  });

  it('excludes a market whose activity stats have never been computed (null, not 0)', () => {
    expect(computeTrendingScore({ ...healthy, uniqueTraders24h: null })).toBeNull();
    expect(computeTrendingScore({ ...healthy, tradeCount24h: null })).toBeNull();
  });

  it('ranks a market with more unique traders above an equal-volume market with fewer', () => {
    const broad = computeTrendingScore({ ...healthy, uniqueTraders24h: 50 });
    const narrow = computeTrendingScore({ ...healthy, uniqueTraders24h: 5 });
    expect(broad).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(broad!).toBeGreaterThan(narrow!);
  });

  it('is deterministic — identical inputs always produce the identical score', () => {
    expect(computeTrendingScore(healthy)).toBe(computeTrendingScore(healthy));
  });

  it('a token can trend on rising activity breadth even with modest volume', () => {
    // Just above every floor, but with strong trader/trade breadth.
    const risingActivity = computeTrendingScore({
      volume24hUsd: TRENDING_RANKING.minVolume24hUsd + 100,
      liquidityUsd: TRENDING_RANKING.minLiquidityUsd,
      uniqueTraders24h: 200,
      tradeCount24h: 400,
    });
    // A much higher-volume market with only barely-qualifying activity breadth.
    const volumeOnly = computeTrendingScore({
      volume24hUsd: 1_000_000,
      liquidityUsd: TRENDING_RANKING.minLiquidityUsd,
      uniqueTraders24h: TRENDING_RANKING.minUniqueTraders24h,
      tradeCount24h: TRENDING_RANKING.minTradeCount24h,
    });
    expect(risingActivity).not.toBeNull();
    expect(volumeOnly).not.toBeNull();
    expect(risingActivity!).toBeGreaterThan(volumeOnly!);
  });
});
