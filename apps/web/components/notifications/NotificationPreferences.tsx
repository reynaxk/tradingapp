'use client';

import type { NotificationPreferences } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchNotificationPreferences, updateNotificationPreferences } from '@/lib/notifications-client';
import { hasStoredSession } from '@/lib/session-client';

const FIELDS: { key: keyof NotificationPreferences; label: string; detail: string }[] = [
  { key: 'follows', label: 'New followers', detail: 'When someone starts following you' },
  { key: 'likes', label: 'Likes', detail: 'When someone likes one of your trades' },
  { key: 'followedTraderTrades', label: 'Trades from people you follow', detail: 'When a trader you follow makes a trade' },
  { key: 'whaleTrades', label: 'Whale trades', detail: `Large trades in tokens you've traded before` },
  { key: 'trendingTokens', label: 'Trending tokens', detail: 'When a token newly starts trending' },
];

/** Server-authoritative toggles — see docs/NOTIFICATIONS.md#preferences. Every change is
 *  saved immediately (no separate "Save" step) and reflects the server's actual response,
 *  never an assumed value, so this can never drift from what the API will really enforce. */
export function NotificationPreferencesPanel() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) return;
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch(() => setError(true));
  }, []);

  async function toggle(key: keyof NotificationPreferences): Promise<void> {
    if (!prefs) return;
    const next = !prefs[key];
    setPrefs({ ...prefs, [key]: next }); // optimistic
    setSaving(key);
    try {
      const saved = await updateNotificationPreferences({ [key]: next });
      setPrefs(saved);
    } catch {
      setPrefs((current) => (current ? { ...current, [key]: !next } : current)); // revert
    } finally {
      setSaving(null);
    }
  }

  if (!hasStoredSession()) return null;
  if (error) return null;
  if (!prefs) {
    return (
      <Surface className="flex flex-col gap-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </Surface>
    );
  }

  return (
    <Surface className="flex flex-col divide-y divide-line p-2">
      {FIELDS.map(({ key, label, detail }) => (
        <div key={key} className="flex items-center justify-between gap-4 px-3 py-3">
          <div className="min-w-0">
            <p className="font-body text-sm font-medium text-ink-900">{label}</p>
            <p className="truncate font-body text-xs text-ink-400">{detail}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[key]}
            aria-label={label}
            disabled={saving === key}
            onClick={() => void toggle(key)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${prefs[key] ? 'bg-accent' : 'bg-line'}`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${prefs[key] ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
            />
          </button>
        </div>
      ))}
    </Surface>
  );
}
