'use client';

import type {
  PersonalizedFeedPage,
  PersonalizedToken,
  SavedSearchDto,
  WhatsMissed,
} from '@fomo/domain';
import { authedFetch, expectOk, hasStoredSession } from './session-client';

/**
 * Phase 5 — client-side reads for the personalized endpoints, same split as
 * lib/social-client.ts vs lib/social-api.ts: personalization requires a session, which only
 * exists in this browser's localStorage. See docs/TRADER_INTELLIGENCE.md.
 */

export { hasStoredSession };

/** Returns an empty list rather than lazily starting a session — viewing the discover page
 *  must never itself create one (see lib/session-client.ts#ensureSessionToken). Callers
 *  should gate on hasStoredSession() before calling this, same as every other
 *  first-authenticated-read in this app. */
export async function fetchPersonalizedDiscovery(limit = 12): Promise<PersonalizedToken[]> {
  if (!hasStoredSession()) return [];
  const res = await authedFetch(`/discovery/personalized?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchPersonalizedFeed(
  params: { cursor?: string; limit?: number } = {},
): Promise<PersonalizedFeedPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/discovery/feed?${query.toString()}`);
  await expectOk(res, 'load your personalized feed');
  return res.json();
}

// ---------------------------------------------------------------------------------------
// Phase 6 — saved searches, see docs/PHASE6_RETENTION_SOCIAL.md#saved-searches.
// ---------------------------------------------------------------------------------------

export async function fetchSavedSearches(): Promise<SavedSearchDto[]> {
  if (!hasStoredSession()) return [];
  const res = await authedFetch('/discovery/saved-searches');
  if (!res.ok) return [];
  return res.json();
}

export async function createSavedSearch(
  query: string,
  displayName?: string,
): Promise<SavedSearchDto> {
  const res = await authedFetch('/discovery/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, displayName: displayName || undefined }),
  });
  await expectOk(res, 'save this search');
  return res.json();
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const res = await authedFetch(`/discovery/saved-searches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await expectOk(res, 'delete this saved search');
}

// ---------------------------------------------------------------------------------------
// Phase 6 — return loop / streak, see docs/PHASE6_RETENTION_SOCIAL.md#return-loop.
// ---------------------------------------------------------------------------------------

/** Never creates a session just to check — an anonymous visitor has nothing to have missed. */
export async function fetchWhatsMissed(): Promise<WhatsMissed | null> {
  if (!hasStoredSession()) return null;
  const res = await authedFetch('/discovery/whats-missed');
  if (!res.ok) return null;
  return res.json();
}

/** Called once per discover-page visit by a browser that already has a session — never
 *  creates one itself (see hasStoredSession gate in the caller), matching every other
 *  "must never itself start a session" rule in this app. */
export async function markDiscoverySeen(): Promise<{
  currentStreakDays: number;
  longestStreakDays: number;
} | null> {
  const res = await authedFetch('/discovery/mark-seen', { method: 'POST' });
  if (!res.ok) return null;
  return res.json();
}
