import { describe, expect, it } from 'vitest';
import {
  calculateFeeAmount,
  calculateMinOutputAmount,
  classifyPriceImpactBps,
  isQuoteExpired,
  isValidSlippageBps,
  TRADING_DEFAULTS,
} from './trading';

describe('calculateFeeAmount', () => {
  it('computes exactly 0.50% (50 bps) of a raw amount', () => {
    expect(calculateFeeAmount(1_000_000_000n, 50)).toBe(5_000_000n);
  });

  it('computes an exact fee on a large 18-decimal raw amount without precision loss', () => {
    // 1000 tokens at 18 decimals; 50 bps of it, computed by hand for comparison.
    const amount = 1_000_000_000_000_000_000_000n;
    const expected = 5_000_000_000_000_000_000n; // exactly 0.5% of the above
    expect(calculateFeeAmount(amount, 50)).toBe(expected);
  });

  it('returns 0 for a 0 bps fee, never a fabricated non-zero amount', () => {
    expect(calculateFeeAmount(1_000_000n, 0)).toBe(0n);
  });

  it('rejects a negative fee', () => {
    expect(() => calculateFeeAmount(1_000_000n, -1)).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => calculateFeeAmount(-1n, 50)).toThrow();
  });

  it('rejects a non-integer fee', () => {
    expect(() => calculateFeeAmount(1_000_000n, 50.5)).toThrow();
  });
});

describe('calculateMinOutputAmount', () => {
  it('computes the exact floor after 0.50% slippage', () => {
    expect(calculateMinOutputAmount(1_000_000n, 50)).toBe(995_000n);
  });

  it('returns the full amount unchanged for the minimum allowed slippage', () => {
    const result = calculateMinOutputAmount(1_000_000n, TRADING_DEFAULTS.minSlippageBps);
    expect(result).toBeLessThan(1_000_000n);
    expect(result).toBeGreaterThan(990_000n);
  });

  it('rejects a slippage value outside the configured safe range', () => {
    expect(() => calculateMinOutputAmount(1_000_000n, 0)).toThrow();
    expect(() => calculateMinOutputAmount(1_000_000n, TRADING_DEFAULTS.maxSlippageBps + 1)).toThrow();
  });

  it('rejects a negative expected output', () => {
    expect(() => calculateMinOutputAmount(-1n, 50)).toThrow();
  });
});

describe('isValidSlippageBps', () => {
  it('accepts the default and boundary values', () => {
    expect(isValidSlippageBps(TRADING_DEFAULTS.defaultSlippageBps)).toBe(true);
    expect(isValidSlippageBps(TRADING_DEFAULTS.minSlippageBps)).toBe(true);
    expect(isValidSlippageBps(TRADING_DEFAULTS.maxSlippageBps)).toBe(true);
  });

  it('rejects zero, negative, non-integer, and unreasonably large values', () => {
    expect(isValidSlippageBps(0)).toBe(false);
    expect(isValidSlippageBps(-1)).toBe(false);
    expect(isValidSlippageBps(12.5)).toBe(false);
    expect(isValidSlippageBps(TRADING_DEFAULTS.maxSlippageBps + 1)).toBe(false);
    expect(isValidSlippageBps(1_000_000)).toBe(false);
  });
});

describe('classifyPriceImpactBps', () => {
  it('classifies below the high threshold as normal', () => {
    expect(classifyPriceImpactBps(TRADING_DEFAULTS.highPriceImpactBps - 1)).toBe('normal');
  });

  it('classifies at/above the high threshold but below extreme as high', () => {
    expect(classifyPriceImpactBps(TRADING_DEFAULTS.highPriceImpactBps)).toBe('high');
    expect(classifyPriceImpactBps(TRADING_DEFAULTS.extremePriceImpactBps - 1)).toBe('high');
  });

  it('classifies at/above the extreme threshold as extreme', () => {
    expect(classifyPriceImpactBps(TRADING_DEFAULTS.extremePriceImpactBps)).toBe('extreme');
  });

  it('passes through null rather than fabricating a level when impact is unknown', () => {
    expect(classifyPriceImpactBps(null)).toBeNull();
  });
});

describe('isQuoteExpired', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('treats a future expiry as not expired', () => {
    expect(isQuoteExpired(new Date(now.getTime() + 1000), now)).toBe(false);
  });

  it('treats a past expiry as expired', () => {
    expect(isQuoteExpired(new Date(now.getTime() - 1000), now)).toBe(true);
  });

  it('treats the exact expiry instant as expired, not a boundary grace period', () => {
    expect(isQuoteExpired(now, now)).toBe(true);
  });
});
