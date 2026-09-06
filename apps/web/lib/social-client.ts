'use client';

import type { SocialActivity } from '@fomo/domain';
import { clientEnv } from './env';

/**
 * Every browser-side call the social layer needs: the anonymous session (see
 * docs/SOCIAL.md#authentication), follow/like mutations, and the live activity feed. This
 * is the one place apps/web talks to the API directly from the browser rather than through
 * a Server Component — SSE and user-triggered mutations both structurally require a real
 * browser-to-API connection. Everything else in this app still goes through
 * lib/market-api.ts / lib/social-api.ts on the server. See docs/SOCIAL.md#realtime.
 */

const TOKEN_STORAGE_KEY = 'fomo:session-token';
const API_BASE = clientEnv.NEXT_PUBLIC_API_BASE_URL;

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — fall through to a fresh session
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Nothing to persist to — the session still works for this page load, just won't
    // survive a refresh. Not worth surfacing as an error to the user.
  }
}

/** Lazily creates an anonymous session on first use — never on page load, so viewing the
 *  app never requires one (see docs/SOCIAL.md#authentication). */
async function ensureSessionToken(): Promise<string> {
  const existing = readStoredToken();
  if (existing) return existing;

  const res = await fetch(`${API_BASE}/v1/identity/session`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not start a session');
  const body = (await res.json()) as { token: string };
  storeToken(body.token);
  return body.token;
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureSessionToken();
  return fetch(`${API_BASE}/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

async function expectOk(res: Response, action: string): Promise<void> {
  if (!res.ok) throw new Error(`Failed to ${action} (${res.status})`);
}

/**
 * A Server Component render never has the browser's session (it lives only in this
 * browser's localStorage, not a cookie — see docs/SOCIAL.md#authentication), so
 * `isFollowedByMe` from the server-rendered page is always `null`. Once mounted, resolve
 * the real state using whatever session this browser already has — never creating a new
 * one just to check, since viewing a profile must never require a session.
 */
/** True only if this browser already has a session — never creates one. Lets the UI show
 *  an honest "follow someone to build your feed" empty state for a new visitor instead of
 *  silently minting an anonymous session just because they clicked a tab. */
export function hasStoredSession(): boolean {
  return readStoredToken() !== null;
}

export async function checkFollowStatus(address: string): Promise<boolean> {
  const token = readStoredToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/v1/social/traders/${encodeURIComponent(address)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const profile = (await res.json()) as { isFollowedByMe: boolean | null };
    return profile.isFollowedByMe === true;
  } catch {
    return false;
  }
}

export async function followTrader(address: string): Promise<void> {
  const res = await authedFetch(`/social/traders/${encodeURIComponent(address)}/follow`, { method: 'POST' });
  await expectOk(res, 'follow trader');
}

export async function unfollowTrader(address: string): Promise<void> {
  const res = await authedFetch(`/social/traders/${encodeURIComponent(address)}/follow`, { method: 'DELETE' });
  await expectOk(res, 'unfollow trader');
}

export async function likeActivity(id: string): Promise<void> {
  const res = await authedFetch(`/social/activity/${encodeURIComponent(id)}/like`, { method: 'POST' });
  await expectOk(res, 'like activity');
}

export async function unlikeActivity(id: string): Promise<void> {
  const res = await authedFetch(`/social/activity/${encodeURIComponent(id)}/like`, { method: 'DELETE' });
  await expectOk(res, 'unlike activity');
}

export interface ActivityPage {
  items: SocialActivity[];
  nextCursor: string | null;
}

/** Client-safe read for the live feed's "catch up since my last item" fetch — the same
 *  endpoint lib/social-api.ts's server-side fetchGlobalActivity calls, just from the
 *  browser (unauthenticated reads work fine without a session). */
export async function fetchLatestActivity(params: { cursor?: string; limit?: number; tokenAddress?: string }): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.tokenAddress) query.set('tokenAddress', params.tokenAddress);
  const res = await fetch(`${API_BASE}/v1/social/activity?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch activity (${res.status})`);
  return res.json();
}

export async function fetchLatestTraderActivity(address: string, params: { cursor?: string; limit?: number }): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await fetch(`${API_BASE}/v1/social/traders/${encodeURIComponent(address)}/activity?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch trader activity (${res.status})`);
  return res.json();
}

/** Following feed requires a session — unlike every other read in this file, it's
 *  personalized, so it goes through `authedFetch` and lazily starts a session if the
 *  viewer somehow reaches this without one (they'd need to already follow someone). */
export async function fetchLatestFollowingActivity(params: { cursor?: string; limit?: number }): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/social/activity/following?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch following activity (${res.status})`);
  return res.json();
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to the activity SSE stream — see docs/SOCIAL.md#realtime. Calls `onPing`
 * whenever new activity lands (the caller decides what to do — refetch, show a "N new"
 * pill, etc.) and `onStatus` whenever the connection's honest state changes, so the UI
 * never claims to be live when it isn't (see docs/SOCIAL.md#error-states). Returns an
 * unsubscribe function.
 */
export function subscribeToActivityStream(onPing: () => void, onStatus: (status: RealtimeStatus) => void): () => void {
  onStatus('connecting');
  const source = new EventSource(`${API_BASE}/v1/social/activity/stream`);

  source.addEventListener('activity', () => onPing());
  source.addEventListener('heartbeat', () => onStatus('live'));
  source.onopen = () => onStatus('live');
  source.onerror = () => onStatus('reconnecting'); // the browser retries EventSource on its own

  return () => source.close();
}
