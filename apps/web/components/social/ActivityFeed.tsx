'use client';

import type { SocialActivity } from '@fomo/domain';
import { Button } from '@fomo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLatestActivity,
  fetchLatestFollowingActivity,
  fetchLatestTraderActivity,
  subscribeToActivityStream,
  type ActivityPage,
  type RealtimeStatus,
} from '@/lib/social-client';
import { ActivityCard } from './ActivityCard';
import { EmptyState } from '../market/EmptyState';
import { Skeleton } from '../market/Skeleton';

/** A plain, serializable description of which feed to drive — a Server Component page
 *  can't hand a Client Component a function prop, so the fetch itself is chosen here from
 *  data instead. */
export type ActivityScope =
  | { type: 'global' }
  | { type: 'token'; address: string }
  | { type: 'trader'; address: string }
  | { type: 'following' };

function fetchScopedPage(scope: ActivityScope, cursor: string | undefined): Promise<ActivityPage> {
  switch (scope.type) {
    case 'global':
      return fetchLatestActivity({ cursor, limit: 20 });
    case 'token':
      return fetchLatestActivity({ cursor, limit: 20, tokenAddress: scope.address });
    case 'trader':
      return fetchLatestTraderActivity(scope.address, { cursor, limit: 20 });
    case 'following':
      return fetchLatestFollowingActivity({ cursor, limit: 20 });
  }
}

/**
 * The live activity feed — see docs/SOCIAL.md#realtime.
 * New activity never auto-inserts itself above whatever the viewer is currently reading:
 * it surfaces as a "N new" pill, and only lands in the list once they click it. The
 * realtime connection's honest state (connecting/live/reconnecting) is always visible,
 * never silently pretended. One component drives the global feed, one token's activity,
 * one trader's activity, and the (personalized) following feed — `scope` just picks which
 * lib/social-client.ts fetcher backs it.
 */
export function ActivityFeed({
  initialItems,
  initialCursor,
  scope,
  live = true,
  emptyTitle = 'No recent activity yet.',
  emptyDetail,
}: {
  initialItems: SocialActivity[];
  initialCursor: string | null;
  scope: ActivityScope;
  live?: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) return;
    const unsubscribe = subscribeToActivityStream(
      () => setPendingCount((count) => count + 1),
      (next) => setStatus(next),
    );
    return unsubscribe;
  }, [live]);

  const revealNew = useCallback(async () => {
    setIsRevealing(true);
    try {
      const page = await fetchScopedPage(scope, undefined);
      const knownIds = new Set(items.map((item) => item.id));
      const fresh = page.items.filter((item) => !knownIds.has(item.id));
      if (fresh.length > 0) {
        setItems((current) => [...fresh, ...current]);
      }
      setPendingCount(0);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // A failed refresh just leaves the pill showing — the user can try again, and the
      // next successful poll/SSE ping will still catch things up.
    } finally {
      setIsRevealing(false);
    }
  }, [items, scope]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchScopedPage(scope, cursor);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // Leave the cursor as-is — the button stays visible and retrying is just a click away.
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, scope]);

  return (
    <div>
      <div ref={topRef} />
      <div className="mb-3 flex items-center justify-between">
        {live ? <RealtimeIndicator status={status} /> : <span />}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => void revealNew()}
            disabled={isRevealing}
            className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
          >
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {pendingCount} new {pendingCount === 1 ? 'trade' : 'trades'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

function RealtimeIndicator({ status }: { status: RealtimeStatus }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-ink-400">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-up" />
        Live
      </span>
    );
  }
  if (status === 'reconnecting') {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-ink-400">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-down" />
        Live updates paused — reconnecting…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-ink-400">
      <Skeleton className="h-1.5 w-1.5 rounded-full" />
      Connecting…
    </span>
  );
}
