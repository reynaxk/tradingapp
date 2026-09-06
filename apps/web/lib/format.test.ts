import { describe, expect, it } from 'vitest';
import {
  formatCompactUsd,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  priceDirection,
  truncateAddress,
} from './format';

describe('formatPrice', () => {
  it('renders an em dash for null rather than $0.00 or NaN', () => {
    expect(formatPrice(null)).toBe('—');
  });

  it('uses 2 decimals for prices at or above $1', () => {
    expect(formatPrice(2455.23)).toBe('$2,455.23');
  });

  it('scales up precision for sub-cent meme-token prices instead of showing $0.00', () => {
    expect(formatPrice(0.0000123)).toBe('$0.00001230');
  });
});

describe('formatCompactUsd', () => {
  it('renders an em dash for null', () => {
    expect(formatCompactUsd(null)).toBe('—');
  });

  it('abbreviates millions and thousands', () => {
    expect(formatCompactUsd(117_566_374)).toBe('$117.57M');
    expect(formatCompactUsd(69_133.7)).toBe('$69.1K');
  });

  it('leaves small values unabbreviated', () => {
    expect(formatCompactUsd(42)).toBe('$42.00');
  });
});

describe('formatPercent', () => {
  it('renders an em dash for null rather than 0%', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('always shows a sign so direction reads at a glance', () => {
    expect(formatPercent(12.345)).toBe('+12.35%');
    expect(formatPercent(-5.6)).toBe('-5.60%');
  });
});

describe('priceDirection', () => {
  it('treats null and zero as flat, not down', () => {
    expect(priceDirection(null)).toBe('flat');
    expect(priceDirection(0)).toBe('flat');
  });

  it('classifies positive and negative correctly', () => {
    expect(priceDirection(0.01)).toBe('up');
    expect(priceDirection(-0.01)).toBe('down');
  });
});

describe('truncateAddress', () => {
  it('shortens a real address to a readable form', () => {
    expect(truncateAddress('0x4200000000000000000000000000000000000006')).toBe('0x4200…0006');
  });
});

describe('formatDateTime', () => {
  it('always renders in en-US, regardless of the host process locale', () => {
    // A regression check: this must never fall back to Date.prototype.toLocaleString()'s
    // implicit-locale form, which renders differently per server/host (caught by actually
    // running this page — it showed Russian-locale output in one environment).
    expect(formatDateTime('2026-03-05T14:30:00Z')).toMatch(/^Mar 5, 2026/);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('renders "just now" for anything under 5 seconds old', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 2000).toISOString(), now)).toBe('just now');
  });

  it('renders seconds for under a minute', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 42_000).toISOString(), now)).toBe('42s ago');
  });

  it('renders minutes for under an hour', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 8 * 60_000).toISOString(), now)).toBe('8m ago');
  });

  it('renders hours for under a day', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60 * 60_000).toISOString(), now)).toBe('5h ago');
  });

  it('renders days for under a week', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString(), now)).toBe('3d ago');
  });

  it('falls back to an absolute date past a week', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 10 * 24 * 60 * 60_000).toISOString(), now)).toMatch(/^Dec 22, 2025/);
  });

  it('never renders a negative age for a timestamp fractionally ahead of "now" (clock skew)', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 500).toISOString(), now)).toBe('just now');
  });
});
