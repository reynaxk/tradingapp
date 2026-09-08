'use client';

import type { WatchlistPage } from '@fomo/domain';
import { authedFetch, expectOk, hasStoredSession } from './session-client';

/**
 * Phase 6 — client-side reads/mutations for token watchlists, same split as
 * lib/social-client.ts: a session lives only in this browser's localStorage, so watch
 * state/mutations structurally require a real browser-to-API call rather than a Server
 * Component. See docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 */

export { hasStoredSession };

/** Never creates a session just to check — same contract as checkFollowStatus. A browser
 *  with no session can't be watching anything, so this is `false` without a network call. */
export async function checkWatchStatus(address: string): Promise<boolean> {
  if (!hasStoredSession()) return false;
  try {
    const res = await authedFetch(`/market/tokens/${encodeURIComponent(address)}/watch`);
    if (!res.ok) return false;
    const body = (await res.json()) as { watching: boolean | null };
    return body.watching === true;
  } catch {
    return false;
  }
}

export async function watchToken(address: string): Promise<void> {
  const res = await authedFetch(`/market/tokens/${encodeURIComponent(address)}/watch`, {
    method: 'POST',
  });
  await expectOk(res, 'watch this token');
}

export async function unwatchToken(address: string): Promise<void> {
  const res = await authedFetch(`/market/tokens/${encodeURIComponent(address)}/watch`, {
    method: 'DELETE',
  });
  await expectOk(res, 'unwatch this token');
}

export async function fetchWatchlist(
  params: { cursor?: string; limit?: number } = {},
): Promise<WatchlistPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/social/watchlist?${query.toString()}`);
  await expectOk(res, 'load your watchlist');
  return res.json();
}
