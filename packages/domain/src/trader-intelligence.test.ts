import { describe, expect, it } from 'vitest';
import {
  buildPersonalizationReasons,
  computeActivityFrequencyPerDay,
  computeBuyRatio,
  computeConcentrationIndex,
  computePersonalizationScore,
  feedReasonText,
  isRecentlyRisingToken,
  isRisingTrader,
  PERSONALIZATION_WEIGHTS,
  RECENCY_WINDOW_HOURS,
  RISING_TOKEN_WINDOW_HOURS,
  RISING_TRADER_CONFIG,
} from './trader-intelligence';

describe('computeBuyRatio', () => {
  it('returns null for a wallet with no trades — not a fabricated 0 or 1', () => {
    expect(computeBuyRatio(0, 0)).toBeNull();
  });

  it('is 1 for a buy-only wallet', () => {
    expect(computeBuyRatio(5, 5)).toBe(1);
  });

  it('is 0 for a sell-only wallet', () => {
    expect(computeBuyRatio(0, 5)).toBe(0);
  });

  it('is the plain ratio otherwise', () => {
    expect(computeBuyRatio(3, 4)).toBe(0.75);
  });
});

describe('computeConcentrationIndex', () => {
  it('returns null for an empty list — nothing to measure', () => {
    expect(computeConcentrationIndex([])).toBeNull();
  });

  it('returns null when every volume is zero', () => {
    expect(computeConcentrationIndex([0, 0, 0])).toBeNull();
  });

  it('is 1 when all volume is in a single token', () => {
    expect(computeConcentrationIndex([1000])).toBe(1);
  });

  it('is 0.5 split evenly across two tokens', () => {
    expect(computeConcentrationIndex([500, 500])).toBeCloseTo(0.5, 10);
  });

  it('is lower the more evenly volume is spread across more tokens', () => {
    const two = computeConcentrationIndex([500, 500])!;
    const four = computeConcentrationIndex([250, 250, 250, 250])!;
    expect(four).toBeLessThan(two);
  });

  it('ignores negative inputs rather than letting them skew the index below 0', () => {
    // A defensive floor — this should never occur with real volumeUsd data, but the
    // formula must not produce something nonsensical if it somehow did.
    const result = computeConcentrationIndex([100, -50]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
  });
});

describe('computeActivityFrequencyPerDay', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');

  it('returns null for a wallet with zero trades', () => {
    expect(computeActivityFrequencyPerDay(0, now, now)).toBeNull();
  });

  it('floors the denominator at 1 day, so a brand-new wallet is never divided by ~0', () => {
    const justNow = new Date(now.getTime() - 60_000); // 1 minute ago
    expect(computeActivityFrequencyPerDay(10, justNow, now)).toBe(10);
  });

  it('computes trades-per-day over the real elapsed window', () => {
    const firstSeen = new Date(now.getTime() - 10 * 86_400_000); // 10 days ago
    expect(computeActivityFrequencyPerDay(20, firstSeen, now)).toBeCloseTo(2, 10);
  });
});

describe('isRecentlyRisingToken', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');

  it('is false when the token has never been trending', () => {
    expect(isRecentlyRisingToken(null, now)).toBe(false);
  });

  it('is true right at the transition moment', () => {
    expect(isRecentlyRisingToken(now, now)).toBe(true);
  });

  it('is true just inside the window boundary', () => {
    const at = new Date(now.getTime() - RISING_TOKEN_WINDOW_HOURS * 3_600_000 + 1000);
    expect(isRecentlyRisingToken(at, now)).toBe(true);
  });

  it('is false just outside the window boundary', () => {
    const at = new Date(now.getTime() - RISING_TOKEN_WINDOW_HOURS * 3_600_000 - 1000);
    expect(isRecentlyRisingToken(at, now)).toBe(false);
  });

  it('is false for a transition timestamp in the future (clock skew defensiveness)', () => {
    const future = new Date(now.getTime() + 3_600_000);
    expect(isRecentlyRisingToken(future, now)).toBe(false);
  });
});

describe('isRisingTrader', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');
  const firstSeen = new Date(now.getTime() - 10 * 86_400_000); // 10 days ago -> baseline 1/day at totalSwaps=10

  it('is false below the absolute minimum trade-count floor, no matter the historical rate', () => {
    expect(
      isRisingTrader({ tradeCount24h: RISING_TRADER_CONFIG.minTradeCount24h - 1, totalSwaps: 1, firstSeenAt: firstSeen, now }),
    ).toBe(false);
  });

  it('is false when today merely matches the historical average', () => {
    // totalSwaps=10 over 10 days -> 1/day baseline; today's 3 is below the 2x multiplier bar (2/day) — wait 3 >= 2, so bump totalSwaps.
    expect(isRisingTrader({ tradeCount24h: 4, totalSwaps: 40, firstSeenAt: firstSeen, now })).toBe(false); // baseline 4/day, needs 8+
  });

  it('is true when today clears both the floor and the multiplier over the historical baseline', () => {
    // totalSwaps=10 over 10 days -> baseline 1/day; today's 3 clears both minTradeCount24h and 2x baseline.
    expect(isRisingTrader({ tradeCount24h: 3, totalSwaps: 10, firstSeenAt: firstSeen, now })).toBe(true);
  });

  it('is false for a wallet with no trading history at all', () => {
    expect(isRisingTrader({ tradeCount24h: 5, totalSwaps: 0, firstSeenAt: now, now })).toBe(false);
  });
});

describe('computePersonalizationScore', () => {
  const noSignals = { marketActivityScore: 0, followedTraderLabel: null, viewerHasTraded: false, viewerLikeCount: 0, hoursSinceRelevantActivity: null };

  it('is exactly 0 when every signal is absent', () => {
    expect(computePersonalizationScore(noSignals)).toBe(0);
  });

  it('is deterministic — identical inputs always produce the identical score', () => {
    const signals = { ...noSignals, marketActivityScore: 1.2, viewerHasTraded: true };
    expect(computePersonalizationScore(signals)).toBe(computePersonalizationScore(signals));
  });

  it('adds exactly the followedTrader weight when a followed trader signal is present', () => {
    const withSignal = computePersonalizationScore({ ...noSignals, followedTraderLabel: 'Alex' });
    expect(withSignal).toBeCloseTo(PERSONALIZATION_WEIGHTS.followedTrader, 10);
  });

  it('adds exactly the tradingInterest weight when the viewer has traded the token', () => {
    const withSignal = computePersonalizationScore({ ...noSignals, viewerHasTraded: true });
    expect(withSignal).toBeCloseTo(PERSONALIZATION_WEIGHTS.tradingInterest, 10);
  });

  it('engagement grows with like count but stays log-scaled (diminishing marginal returns)', () => {
    const score = (likes: number) => computePersonalizationScore({ ...noSignals, viewerLikeCount: likes });
    expect(score(10)).toBeGreaterThan(score(1));
    // Equal-sized steps (+1 like) at different starting points — a log curve's marginal
    // gain shrinks as the input grows, unlike a linear score where every +1 like would add
    // the same amount regardless of where you started.
    const marginalAtLow = score(2) - score(1);
    const marginalAtHigh = score(101) - score(100);
    expect(marginalAtHigh).toBeLessThan(marginalAtLow);
  });

  it('recency contributes its full weight at time zero and decays to 0 at the window edge', () => {
    const atZero = computePersonalizationScore({ ...noSignals, hoursSinceRelevantActivity: 0 });
    const atEdge = computePersonalizationScore({ ...noSignals, hoursSinceRelevantActivity: RECENCY_WINDOW_HOURS });
    const pastEdge = computePersonalizationScore({ ...noSignals, hoursSinceRelevantActivity: RECENCY_WINDOW_HOURS * 2 });
    expect(atZero).toBeCloseTo(PERSONALIZATION_WEIGHTS.recency, 10);
    expect(atEdge).toBeCloseTo(0, 10);
    expect(pastEdge).toBeGreaterThanOrEqual(0); // never negative past the window
  });

  it('combines every signal additively', () => {
    const combined = computePersonalizationScore({
      marketActivityScore: 1,
      followedTraderLabel: 'Alex',
      viewerHasTraded: true,
      viewerLikeCount: 0,
      hoursSinceRelevantActivity: null,
    });
    const expected = PERSONALIZATION_WEIGHTS.marketActivity * 1 + PERSONALIZATION_WEIGHTS.followedTrader + PERSONALIZATION_WEIGHTS.tradingInterest;
    expect(combined).toBeCloseTo(expected, 10);
  });
});

describe('buildPersonalizationReasons', () => {
  const noSignals = { marketActivityScore: 0, followedTraderLabel: null, viewerHasTraded: false, viewerLikeCount: 0, hoursSinceRelevantActivity: null };

  it('falls back to an objective reason when no personal signal fired', () => {
    expect(buildPersonalizationReasons(noSignals)).toEqual(['Active on the market']);
  });

  it('names the specific followed trader', () => {
    expect(buildPersonalizationReasons({ ...noSignals, followedTraderLabel: 'Alex' })).toContain('Alex traded this recently');
  });

  it('includes every fired signal, not just the first', () => {
    const reasons = buildPersonalizationReasons({ ...noSignals, followedTraderLabel: 'Alex', viewerHasTraded: true, viewerLikeCount: 2 });
    expect(reasons).toHaveLength(3);
  });

  it('never emits an unexplained label like "AI picked" or "smart money"', () => {
    const allPossible = buildPersonalizationReasons({ ...noSignals, followedTraderLabel: 'Alex', viewerHasTraded: true, viewerLikeCount: 5 });
    for (const reason of allPossible) {
      expect(reason.toLowerCase()).not.toMatch(/ai picked|smart money|alpha|top trader/);
    }
  });
});

describe('feedReasonText', () => {
  it('names the followed trader when a label is available', () => {
    expect(feedReasonText('FOLLOWED_TRADER', 'Alex')).toBe('Because you follow Alex');
  });

  it('falls back to a generic phrase when no label is available', () => {
    expect(feedReasonText('FOLLOWED_TRADER', null)).toBe('From a trader you follow');
  });

  it('labels general-discovery items distinctly', () => {
    expect(feedReasonText('GENERAL_DISCOVERY', null)).toBe('Active on the market');
  });
});
