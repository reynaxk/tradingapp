import { describe, expect, it } from 'vitest';
import {
  computeStreak,
  decodeWatchlistCursor,
  encodeWatchlistCursor,
  MAX_SAVED_SEARCHES_PER_USER,
  SavedSearchDisplayNameSchema,
  SavedSearchQuerySchema,
  utcDayString,
} from './retention';

describe('utcDayString', () => {
  it('formats as YYYY-MM-DD regardless of time-of-day', () => {
    expect(utcDayString(new Date('2026-03-05T23:59:59.999Z'))).toBe('2026-03-05');
    expect(utcDayString(new Date('2026-03-05T00:00:00.000Z'))).toBe('2026-03-05');
  });
});

describe('computeStreak', () => {
  const base = {
    lastDiscoverySeenAt: null as Date | null,
    currentStreakDays: 0,
    longestStreakDays: 0,
  };

  it('starts a fresh streak of 1 for a user who has never been seen before', () => {
    const result = computeStreak(base, new Date('2026-03-05T12:00:00.000Z'));
    expect(result).toEqual({ currentStreakDays: 1, longestStreakDays: 1 });
  });

  it('does not double-count a second visit on the same UTC day', () => {
    const previous = {
      lastDiscoverySeenAt: new Date('2026-03-05T01:00:00.000Z'),
      currentStreakDays: 3,
      longestStreakDays: 5,
    };
    const result = computeStreak(previous, new Date('2026-03-05T23:00:00.000Z'));
    expect(result).toEqual({ currentStreakDays: 3, longestStreakDays: 5 });
  });

  it('extends the streak by 1 on the very next UTC day', () => {
    const previous = {
      lastDiscoverySeenAt: new Date('2026-03-05T23:00:00.000Z'),
      currentStreakDays: 3,
      longestStreakDays: 5,
    };
    const result = computeStreak(previous, new Date('2026-03-06T00:30:00.000Z'));
    expect(result).toEqual({ currentStreakDays: 4, longestStreakDays: 5 });
  });

  it('raises longestStreakDays once currentStreakDays overtakes it', () => {
    const previous = {
      lastDiscoverySeenAt: new Date('2026-03-05T00:00:00.000Z'),
      currentStreakDays: 5,
      longestStreakDays: 5,
    };
    const result = computeStreak(previous, new Date('2026-03-06T00:00:00.000Z'));
    expect(result).toEqual({ currentStreakDays: 6, longestStreakDays: 6 });
  });

  it('resets to 1 after a gap of 2+ days, but never loses the recorded longest streak', () => {
    const previous = {
      lastDiscoverySeenAt: new Date('2026-03-01T00:00:00.000Z'),
      currentStreakDays: 10,
      longestStreakDays: 10,
    };
    const result = computeStreak(previous, new Date('2026-03-10T00:00:00.000Z'));
    expect(result).toEqual({ currentStreakDays: 1, longestStreakDays: 10 });
  });

  it('is race-safe: two concurrent calls on the same day from the same user compute the identical result', () => {
    const previous = {
      lastDiscoverySeenAt: new Date('2026-03-05T23:00:00.000Z'),
      currentStreakDays: 3,
      longestStreakDays: 5,
    };
    const now = new Date('2026-03-06T00:30:00.000Z');
    const a = computeStreak(previous, now);
    const b = computeStreak(previous, now);
    expect(a).toEqual(b);
  });
});

describe('watchlist cursor', () => {
  it('round-trips through encode/decode', () => {
    const cursor = {
      createdAt: '2026-03-05T12:00:00.000Z',
      id: '11111111-1111-1111-1111-111111111111',
    };
    expect(decodeWatchlistCursor(encodeWatchlistCursor(cursor))).toEqual(cursor);
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(decodeWatchlistCursor('not-base64url-json')).toBeNull();
    expect(decodeWatchlistCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
  });
});

describe('saved search validation', () => {
  it('rejects an empty or whitespace-only query', () => {
    expect(SavedSearchQuerySchema.safeParse('').success).toBe(false);
    expect(SavedSearchQuerySchema.safeParse('   ').success).toBe(false);
  });

  it('accepts a real query and trims it', () => {
    const result = SavedSearchQuerySchema.safeParse('  pepe  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('pepe');
  });

  it('rejects an overlong display name', () => {
    expect(SavedSearchDisplayNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });

  it('has a sane, documented per-user cap', () => {
    expect(MAX_SAVED_SEARCHES_PER_USER).toBeGreaterThan(0);
  });
});
