'use client';

import type { NotificationDto } from '@fomo/domain';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchNotifications, markNotificationRead } from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';
import { NotificationItem } from './NotificationItem';

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * The shared list body for both the bell dropdown and the full /notifications page — see
 * docs/NOTIFICATIONS.md. `limit` caps the first page (the bell wants a short one); passing
 * `showLoadMore` lets the caller opt into pagination for the rest.
 */
export function NotificationList({
  limit = 20,
  showLoadMore = true,
  refreshKey,
}: {
  limit?: number;
  showLoadMore?: boolean;
  /** Bump this to force a fresh fetch from the top (e.g. when a bell dropdown opens). */
  refreshKey?: number;
}) {
  const [state, setState] = useState<State>('loading');
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    setState('loading');
    fetchNotifications({ limit })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, [limit, refreshKey]);

  async function open(notification: NotificationDto): Promise<void> {
    if (notification.readAt) return;
    setItems((current) => current.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)));
    try {
      await markNotificationRead(notification.id);
    } catch {
      // Optimistic update stands even if the request fails — worst case, it shows read
      // until the next full refetch reconciles it, which is harmless.
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotifications({ cursor, limit });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (state === 'no-session') {
    return <EmptyState title="No notifications yet." detail="Follow traders and engage with trades to start seeing activity here." />;
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (state === 'error') {
    return <EmptyState title="Couldn't load your notifications." detail="Try again in a moment." />;
  }
  if (items.length === 0) {
    return <EmptyState title="No notifications yet." detail="Follows, likes, and trade alerts will show up here." />;
  }

  return (
    <div className="flex flex-col gap-1">
      {items.map((n) => (
        <NotificationItem key={n.id} notification={n} onOpen={open} />
      ))}
      {showLoadMore && cursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-2 rounded-lg border border-line py-2 font-body text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
