import type { RisingToken, RisingTrader, SocialActivity, TokenTraderConnection, TopTrader, TraderTokenStat } from '@fomo/domain';
import { apiGet } from './market-api';

/**
 * Phase 5 — server-side reads for trader intelligence & discovery, same convention as
 * market-api.ts/social-api.ts (always through the API, always server-side). See
 * docs/TRADER_INTELLIGENCE.md. Personalized endpoints require a session and so live in
 * lib/discovery-client.ts instead (client-side, same split social-api.ts/social-client.ts
 * already established).
 */

export async function fetchActiveTraders(limit = 10): Promise<TopTrader[]> {
  const result = await apiGet<TopTrader[]>(`/discovery/active-traders?limit=${limit}`, 30);
  return result ?? [];
}

export async function fetchLargeTrades(limit = 20): Promise<SocialActivity[]> {
  const result = await apiGet<SocialActivity[]>(`/discovery/large-trades?limit=${limit}`, 30);
  return result ?? [];
}

export interface RisingResult {
  tokens: RisingToken[];
  traders: RisingTrader[];
}

export async function fetchRising(limit = 10): Promise<RisingResult> {
  const result = await apiGet<RisingResult>(`/discovery/rising?limit=${limit}`, 30);
  return result ?? { tokens: [], traders: [] };
}

export async function fetchTraderTokens(address: string, limit = 20): Promise<TraderTokenStat[]> {
  const result = await apiGet<TraderTokenStat[]>(`/social/traders/${encodeURIComponent(address)}/tokens?limit=${limit}`, 20);
  return result ?? [];
}

export async function fetchTokenTraders(address: string, limit = 10): Promise<TokenTraderConnection> {
  const result = await apiGet<TokenTraderConnection>(`/market/tokens/${encodeURIComponent(address)}/traders?limit=${limit}`, 20);
  return result ?? { uniqueTraders24h: null, recentTraders: [], activeTraders: [], recentLargeTrades: [] };
}
