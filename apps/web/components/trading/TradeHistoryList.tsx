'use client';

import type { TradeTransactionDto } from '@fomo/domain';
import { Surface, cn } from '@fomo/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { formatDateTime } from '@/lib/format';
import { hasStoredSession } from '@/lib/session-client';
import { getTradeHistory } from '@/lib/trading-client';
import { StatusPill } from './StatusPill';

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * Strictly the caller's own trades — see docs/TRADING.md#authorization. There is no way to
 * view anyone else's trade history from this UI, matching /trade/history's server-side
 * scoping (no ?userId= override exists on either side).
 */
export function TradeHistoryList() {
  const [state, setState] = useState<State>('loading');
  const [items, setItems] = useState<TradeTransactionDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    getTradeHistory({ limit: 20 })
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
      const page = await getTradeHistory({ cursor, limit: 20 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (state === 'no-session') {
    return <EmptyState title="No trades yet." detail="Connect a wallet and make your first trade to see it here." />;
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
    return <EmptyState title="Couldn't load your trade history." detail="Try again in a moment." />;
  }
  if (items.length === 0) {
    return <EmptyState title="No trades yet." detail="Your BUY/SELL trades will show up here once you make one." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((trade) => (
        <Link key={trade.id} href={`/trades/${trade.id}`}>
          <Surface className="flex items-center justify-between gap-3 p-4 hover:border-accent">
            <div className="flex items-center gap-3">
              <span className={cn('font-mono text-xs font-semibold uppercase tracking-wide', trade.side === 'BUY' ? 'text-up' : 'text-down')}>
                {trade.side === 'BUY' ? 'Bought' : 'Sold'}
              </span>
              <span className="font-display text-sm font-semibold text-ink-900">
                {trade.expectedOutputAmountFormatted} {trade.token.symbol ?? ''}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <time className="font-mono text-xs text-ink-400">{formatDateTime(trade.submittedAt)}</time>
              <StatusPill status={trade.status} />
            </div>
          </Surface>
        </Link>
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
