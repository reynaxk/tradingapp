'use client';

import type { WatchedToken } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { PriceChange } from '@/components/market/PriceChange';
import { Skeleton } from '@/components/market/Skeleton';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { WatchButton } from '@/components/market/WatchButton';
import { formatCompactUsd, formatPrice, formatRelativeTime } from '@/lib/format';
import { fetchWatchlist, hasStoredSession } from '@/lib/watchlist-client';

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * "These are the things I care about right now" — see docs/PHASE6_RETENTION_SOCIAL.md#web-ux.
 * Strictly the caller's own watchlist (see /social/watchlist's session-scoped IDOR defense on
 * the API side); this UI has no way to view anyone else's. Same cursor-paginated,
 * session-gated shape as TradeHistoryList.
 */
export function WatchlistView() {
  const [state, setState] = useState<State>('loading');
  const [items, setItems] = useState<WatchedToken[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    fetchWatchlist({ limit: 20 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchWatchlist({ cursor, limit: 20 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function onUnwatched(tokenAddress: string) {
    // Instant feel: drop it from the list immediately rather than waiting on a refetch —
    // WatchButton itself already handles the optimistic toggle + rollback against the API.
    setItems((prev) => prev.filter((item) => item.tokenAddress !== tokenAddress));
  }

  if (state === 'no-session') {
    return (
      <EmptyState
        title="No watchlist yet."
        detail="Sign in and watch a token to start tracking it here."
      />
    );
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (state === 'error') {
    return <EmptyState title="Couldn't load your watchlist." detail="Try again in a moment." />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing on your watchlist yet."
        detail="Watch a token from its page to track its price and activity here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <Surface key={item.tokenAddress} className="flex items-center gap-3 p-4">
          <Link
            href={`/market/${item.tokenAddress}`}
            className="flex min-w-0 flex-1 items-center gap-4"
          >
            <TokenIdentity symbol={item.symbol} name={item.name} logoUrl={item.logoUrl} />
            <div className="ml-auto flex items-center gap-4 font-mono text-sm tabular-nums">
              <span className="font-semibold text-ink-900">{formatPrice(item.priceUsd)}</span>
              <PriceChange value={item.priceChange24hPct} />
              <span className="hidden text-xs text-ink-400 sm:inline">
                Vol {formatCompactUsd(item.volume24hUsd)}
              </span>
              <span className="hidden text-xs text-ink-400 md:inline">
                watched {formatRelativeTime(item.watchedAt)}
              </span>
            </div>
          </Link>
          <WatchButton
            address={item.tokenAddress}
            initialWatching={true}
            compact
            className="ml-1"
            onChange={(watching) => {
              if (!watching) onUnwatched(item.tokenAddress);
            }}
          />
        </Surface>
      ))}
      {cursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="rounded-lg border border-line py-2 font-body text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
