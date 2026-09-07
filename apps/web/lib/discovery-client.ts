'use client';

import type { PersonalizedFeedPage, PersonalizedToken } from '@fomo/domain';
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

export async function fetchPersonalizedFeed(params: { cursor?: string; limit?: number } = {}): Promise<PersonalizedFeedPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/discovery/feed?${query.toString()}`);
  await expectOk(res, 'load your personalized feed');
  return res.json();
}
