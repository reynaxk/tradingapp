'use client';

import type { NotificationDto, NotificationPreferences } from '@fomo/domain';
import { API_BASE, authedFetch, expectOk } from './session-client';

/**
 * Browser-side client for the Phase 4 notification domain — same shape as
 * lib/social-client.ts (mutations + a live stream), see docs/NOTIFICATIONS.md. Every read
 * and mutation here requires a session, unlike most of social-client.ts's reads, since a
 * notification is inherently personal.
 */

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

export async function fetchNotifications(params: { cursor?: string; limit?: number } = {}): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/notifications?${query.toString()}`);
  await expectOk(res, 'load notifications');
  return res.json();
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await authedFetch('/notifications/unread-count');
  await expectOk(res, 'load unread notification count');
  const body = (await res.json()) as { count: number };
  return body.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await authedFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  await expectOk(res, 'mark notification read');
  broadcastLocalRead();
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await authedFetch('/notifications/read-all', { method: 'POST' });
  await expectOk(res, 'mark all notifications read');
  broadcastLocalRead();
}

const LOCAL_READ_EVENT = 'fomo:notifications-read';

/** This app has no shared state layer (see app/providers.tsx's own comment on that), so the
 *  bell and the full /notifications page — two independent component instances that can
 *  both mark things read — sync via a plain DOM CustomEvent instead of introducing one. */
function broadcastLocalRead(): void {
  window.dispatchEvent(new CustomEvent(LOCAL_READ_EVENT));
}

/** Subscribes to "something was marked read somewhere in this tab." Returns an unsubscribe
 *  function, same contract as subscribeToNotificationStream. */
export function onLocalNotificationsRead(callback: () => void): () => void {
  window.addEventListener(LOCAL_READ_EVENT, callback);
  return () => window.removeEventListener(LOCAL_READ_EVENT, callback);
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await authedFetch('/notifications/preferences');
  await expectOk(res, 'load notification preferences');
  return res.json();
}

export async function updateNotificationPreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const res = await authedFetch('/notifications/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await expectOk(res, 'update notification preferences');
  return res.json();
}

async function fetchStreamTicket(): Promise<string> {
  const res = await authedFetch('/notifications/stream-ticket', { method: 'POST' });
  await expectOk(res, 'start notification stream');
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

interface NotificationPing {
  userId: string;
  notificationId: string;
  type: NotificationDto['type'];
  atIso: string;
}

/**
 * Subscribes to the private per-user notification stream — see
 * docs/NOTIFICATIONS.md#realtime-delivery. Unlike `subscribeToActivityStream`
 * (social-client.ts), this cannot simply let the browser's built-in `EventSource` retry
 * handle reconnection: the stream URL carries a single-use ticket, so a native retry
 * (which reuses the exact same URL) would always fail with 401 after the first connection.
 * Every reconnect here — after an error, or after a clean server-side close — fetches a
 * fresh ticket and opens a brand new EventSource instead.
 */
export function subscribeToNotificationStream(
  onPing: (ping: NotificationPing) => void,
  onStatus: (status: RealtimeStatus) => void,
): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  async function connect(): Promise<void> {
    if (cancelled) return;
    onStatus('connecting');
    try {
      const ticket = await fetchStreamTicket();
      if (cancelled) return;

      const es = new EventSource(`${API_BASE}/v1/notifications/stream?ticket=${encodeURIComponent(ticket)}`);
      source = es;
      es.addEventListener('notification', (event) => {
        try {
          onPing(JSON.parse((event as MessageEvent).data) as NotificationPing);
        } catch {
          // Malformed payload — ignore this one ping; the next successful list/unread-count
          // fetch (triggered by the caller on any ping) still catches the client up.
        }
      });
      es.addEventListener('heartbeat', () => onStatus('live'));
      es.onopen = () => onStatus('live');
      es.onerror = () => {
        onStatus('reconnecting');
        es.close();
        if (source === es) source = null;
        scheduleReconnect();
      };
    } catch {
      onStatus('reconnecting');
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (cancelled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, 2000);
  }

  void connect();

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}
