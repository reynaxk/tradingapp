'use client';

import { useState } from 'react';
import { markAllNotificationsRead } from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';
import { NotificationList } from './NotificationList';
import { NotificationPreferencesPanel } from './NotificationPreferences';

export function NotificationsPageClient() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [marking, setMarking] = useState(false);

  async function markAll(): Promise<void> {
    setMarking(true);
    try {
      await markAllNotificationsRead();
      setRefreshKey((key) => key + 1);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-400">All notifications</h2>
          {hasStoredSession() && (
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={marking}
              className="font-mono text-xs text-accent hover:opacity-80 disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>
        <NotificationList limit={20} showLoadMore refreshKey={refreshKey} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-400">Preferences</h2>
        <NotificationPreferencesPanel />
      </section>
    </div>
  );
}
