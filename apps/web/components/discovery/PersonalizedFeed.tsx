'use client';

import type { PersonalizedFeedItem } from '@fomo/domain';
import { Button } from '@fomo/ui';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { ActivityCard } from '@/components/social/ActivityCard';
import { subscribeToActivityStream } from '@/lib/social-client';
import { fetchPersonalizedFeed, hasStoredSession } from '@/lib/discovery-client';
import { ReasonTag } from './ReasonTag';

/**
 * The personalized activity feed — followed-trader activity blended with general market
 * discovery, chronologically, each item tagged with why it's here. See
 * docs/TRADER_INTELLIGENCE.md#personalized-feed. Reuses the existing activity SSE stream
 * for its "new activity" signal (see docs/NOTIFICATIONS.md#realtime-integration) rather
 * than a second realtime channel — a ping just means "something changed, refetch," the
 * same contract every other realtime surface in this app already follows.
 */
export function PersonalizedFeed() {
  const [state, setState] = useState<'no-session' | 'loading' | 'loaded' | 'error'>('loading');
  const [items, setItems] = useState<PersonalizedFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const page = await fetchPersonalizedFeed({ limit: 15 });
      setItems(page.items);
      setCursor(page.nextCursor);
      setHasNew(false);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasStoredSession()) return;
    const unsubscribe = subscribeToActivityStream(
      () => setHasNew(true),
      () => {},
    );
    return unsubscribe;
  }, []);

  async function loadMore(): Promise<void> {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPersonalizedFeed({ cursor, limit: 15 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (state === 'no-session') return null;

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return <EmptyState title="Couldn't load your personalized feed." detail="Try again in a moment." />;
  }

  if (items.length === 0) {
    return <EmptyState title="Nothing here yet." detail="Follow a trader to start seeing their activity, alongside general market discovery." />;
  }

  return (
    <div>
      {hasNew && (
        <button
          type="button"
          onClick={() => void load()}
          className="mb-3 flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
        >
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          New activity
        </button>
      )}
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.activity.id} className="flex flex-col gap-1.5">
            <ReasonTag reason={item.reason} />
            <ActivityCard activity={item.activity} />
          </div>
        ))}
      </div>
      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
