'use client';

import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  fetchUnreadCount,
  markAllNotificationsRead,
  onLocalNotificationsRead,
  subscribeToNotificationStream,
  type RealtimeStatus,
} from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';
import { NotificationList } from './NotificationList';

/**
 * The header notification entry point — badge + a compact dropdown, with a link to the
 * full /notifications page. See docs/NOTIFICATIONS.md. Mounting this must never itself
 * start a session (matches every other part of this app — see
 * lib/session-client.ts#ensureSessionToken's own comment): with no stored session, the bell
 * just renders inert with no badge until the viewer takes an explicit action.
 */
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [refreshKey, setRefreshKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    fetchUnreadCount()
      .then((count) => { if (!cancelled) setUnreadCount(count); })
      .catch(() => {});

    const unsubscribe = subscribeToNotificationStream(
      () => setUnreadCount((count) => count + 1),
      setStatus,
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return onLocalNotificationsRead(() => {
      if (!hasStoredSession()) return;
      fetchUnreadCount().then(setUnreadCount).catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  function toggle(): void {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      setRefreshKey((key) => key + 1);
      // Opening the panel is the first explicit action that may need a session — lazily
      // starting one here (via authedFetch inside fetchUnreadCount, same as every other
      // first-authenticated-action in this app) is fine; merely rendering the bell isn't.
      fetchUnreadCount().then(setUnreadCount).catch(() => {});
    }
  }

  async function markAll(): Promise<void> {
    try {
      await markAllNotificationsRead();
      setUnreadCount(0);
    } catch {
      // Leave the count as-is — the button stays available to retry.
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-surface-raised hover:text-ink-900"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 font-mono text-[0.6rem] font-bold leading-none text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {status === 'live' && <span aria-hidden className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-bg bg-up" />}
      </button>

      {isOpen && (
        <Surface aria-label="Notifications" className="absolute right-0 top-11 z-20 max-h-[70vh] w-80 overflow-y-auto p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-display text-sm font-semibold text-ink-900">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={() => void markAll()} className="font-mono text-xs text-accent hover:opacity-80">
                Mark all read
              </button>
            )}
          </div>
          <NotificationList limit={8} showLoadMore={false} refreshKey={refreshKey} />
          <Link
            href="/notifications"
            onClick={() => setIsOpen(false)}
            className="mt-1 block rounded-lg px-2 py-2 text-center font-mono text-xs text-ink-400 hover:text-ink-900"
          >
            View all
          </Link>
        </Surface>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
