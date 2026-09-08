import { z } from 'zod';
import { MarketSummarySchema } from './market';
import { NotificationDtoSchema } from './notifications';

/**
 * Phase 6 — watchlists, saved searches, and the return-loop/streak signal. Pure types,
 * validation, and deterministic logic only (no I/O, matching every other file in this
 * package) — see docs/PHASE6_RETENTION_SOCIAL.md.
 */

// ---------------------------------------------------------------------------------------
// Watchlists
// ---------------------------------------------------------------------------------------

/** One token on a user's watchlist — the existing `MarketSummary` shape plus when it was
 *  added, so the watchlist page can render exactly what the market/discover pages already
 *  render (price, 24h change, volume) without a second, parallel token-summary shape. */
export const WatchedTokenSchema = MarketSummarySchema.extend({
  watchedAt: z.string().datetime(),
});
export type WatchedToken = z.infer<typeof WatchedTokenSchema>;

/** Keyset cursor for the watchlist listing — same reasoning as `ActivityCursor`/
 *  `NotificationCursor`: a growing per-user list doesn't paginate safely by offset. Keyed on
 *  the TokenWatch row's own `(createdAt, id)`, matching its `@@index([userId, createdAt])`. */
export const WatchlistCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
export type WatchlistCursor = z.infer<typeof WatchlistCursorSchema>;

export function encodeWatchlistCursor(cursor: WatchlistCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** `null` for anything malformed — untrusted client input, same contract as
 *  `decodeActivityCursor`: garbage means "start from the beginning," never a 500. */
export function decodeWatchlistCursor(raw: string): WatchlistCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = WatchlistCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const WatchlistPageSchema = z.object({
  items: z.array(WatchedTokenSchema),
  nextCursor: z.string().nullable(),
});
export type WatchlistPage = z.infer<typeof WatchlistPageSchema>;

// ---------------------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------------------

/** Enforced in the service layer (SavedSearchService), not a DB constraint — a business-rule
 *  bound like "how many searches can one person save" doesn't need schema enforcement, the
 *  same way TraderStats' formulas don't live in SQL. See docs/PHASE6_RETENTION_SOCIAL.md. */
export const MAX_SAVED_SEARCHES_PER_USER = 20;

export const SavedSearchQuerySchema = z.string().trim().min(1).max(200);
export const SavedSearchDisplayNameSchema = z.string().trim().min(1).max(60);

export const CreateSavedSearchSchema = z.object({
  query: SavedSearchQuerySchema,
  displayName: SavedSearchDisplayNameSchema.nullable().optional(),
});
export type CreateSavedSearchInput = z.infer<typeof CreateSavedSearchSchema>;

export const SavedSearchDtoSchema = z.object({
  id: z.string().uuid(),
  query: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedSearchDto = z.infer<typeof SavedSearchDtoSchema>;

// ---------------------------------------------------------------------------------------
// Return loop / streaks
// ---------------------------------------------------------------------------------------

/** UTC calendar day, `YYYY-MM-DD` — the deliberately simple day boundary the streak uses
 *  (see computeStreak). A disclosed simplification: a user's local "today" can disagree with
 *  UTC's near midnight, which this product accepts rather than tracking per-user timezones
 *  for a single subtle engagement signal. */
export function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface StreakState {
  lastDiscoverySeenAt: Date | null;
  currentStreakDays: number;
  longestStreakDays: number;
}

export interface StreakResult {
  currentStreakDays: number;
  longestStreakDays: number;
}

/**
 * Consecutive UTC calendar days with at least one `mark-seen` call — see
 * docs/PHASE6_RETENTION_SOCIAL.md#streaks. Deliberately the only "engagement" number in this
 * product: no points, XP, badges, or leaderboard. Pure function of (previous state, now) —
 * DiscoveryService#markSeen reads the row, calls this, then overwrites with the result.
 * That plain overwrite (never a compare-and-swap) is what makes concurrent calls from
 * multiple browser tabs/sessions safe: every caller is the same user, so two racing calls on
 * the same UTC day compute the identical `today`/`lastDay` pair and therefore the identical
 * result — there is no real conflict, just two writers agreeing on one answer.
 */
export function computeStreak(previous: StreakState, now: Date): StreakResult {
  if (previous.lastDiscoverySeenAt === null) {
    return { currentStreakDays: 1, longestStreakDays: Math.max(1, previous.longestStreakDays) };
  }

  const today = utcDayString(now);
  const lastDay = utcDayString(previous.lastDiscoverySeenAt);
  if (lastDay === today) {
    // Already counted today — a second visit doesn't double-count.
    return {
      currentStreakDays: previous.currentStreakDays,
      longestStreakDays: previous.longestStreakDays,
    };
  }

  const ONE_DAY_MS = 86_400_000;
  const dayGap =
    (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${lastDay}T00:00:00.000Z`)) / ONE_DAY_MS;
  const isConsecutive = dayGap === 1;
  const nextCurrent = isConsecutive ? previous.currentStreakDays + 1 : 1;
  return {
    currentStreakDays: nextCurrent,
    longestStreakDays: Math.max(nextCurrent, previous.longestStreakDays),
  };
}

/** What the "what you missed" surface reads — a thin, bounded window over the existing
 *  Notification table (`createdAt > lastSeenAt`, `LIMIT` applied by the caller), never a new
 *  parallel event-sourcing model. See docs/PHASE6_RETENTION_SOCIAL.md#return-loop. */
export const WHATS_MISSED_MAX_ITEMS = 20;

export const WhatsMissedSchema = z.object({
  /** Bounded by WHATS_MISSED_MAX_ITEMS — a preview, not the full unread list (the
   *  notification center already serves that in full, paginated). */
  items: z.array(NotificationDtoSchema),
  totalUnseen: z.number().int().min(0),
  currentStreakDays: z.number().int().min(0),
  longestStreakDays: z.number().int().min(0),
});
export type WhatsMissed = z.infer<typeof WhatsMissedSchema>;
