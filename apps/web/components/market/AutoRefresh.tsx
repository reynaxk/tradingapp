'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps a server-rendered market page current without a full page reload or a WebSocket
 * — `router.refresh()` re-runs the page's Server Components against the API's cached
 * (revalidating) response. Deliberately the simplest thing that works for Phase 1; see
 * docs/MARKET_DATA.md#real-time-updates for the documented upgrade path once genuinely
 * live push (WS/SSE) earns its complexity.
 */
export function AutoRefresh({ intervalSeconds }: { intervalSeconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [router, intervalSeconds]);

  return null;
}
