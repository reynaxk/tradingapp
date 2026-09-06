import type { SocialActivity, TopTrader, TraderProfile, TrendingToken } from '@fomo/domain';
import { apiGet } from './market-api';

/**
 * Server-side reads for the social layer — same convention as market-api.ts (always
 * through the API, always server-side, never the browser). See docs/SOCIAL.md#api. The
 * one exception (the live SSE stream and follow/like mutations) lives in lib/session.ts,
 * which runs client-side by necessity.
 */

export interface ActivityPage {
  items: SocialActivity[];
  nextCursor: string | null;
}

const EMPTY_PAGE: ActivityPage = { items: [], nextCursor: null };

export async function fetchGlobalActivity(params: { cursor?: string; limit?: number; tokenAddress?: string } = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.tokenAddress) query.set('tokenAddress', params.tokenAddress);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await apiGet<ActivityPage>(`/social/activity${suffix}`, 10);
  return result ?? EMPTY_PAGE;
}

export async function fetchTrending(limit = 12): Promise<TrendingToken[]> {
  const result = await apiGet<TrendingToken[]>(`/social/trending?limit=${limit}`, 20);
  return result ?? [];
}

/** Returns null only when the wallet genuinely has never traded — callers render a "not
 *  found" state, not a backend error (that throws instead). Same contract as fetchToken. */
export async function fetchTraderProfile(address: string): Promise<TraderProfile | null> {
  return apiGet<TraderProfile>(`/social/traders/${encodeURIComponent(address)}`, 15);
}

export async function fetchTraderActivity(address: string, params: { cursor?: string; limit?: number } = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await apiGet<ActivityPage>(`/social/traders/${encodeURIComponent(address)}/activity${suffix}`, 10);
  return result ?? EMPTY_PAGE;
}

export async function fetchTopTraders(limit = 8): Promise<TopTrader[]> {
  const result = await apiGet<TopTrader[]>(`/social/traders/top?limit=${limit}`, 20);
  return result ?? [];
}

export interface TraderSummary {
  address: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function fetchTraderSearch(query: string, limit = 8): Promise<TraderSummary[]> {
  if (!query.trim()) return [];
  const result = await apiGet<TraderSummary[]>(`/social/traders/search?q=${encodeURIComponent(query)}&limit=${limit}`, 10);
  return result ?? [];
}
