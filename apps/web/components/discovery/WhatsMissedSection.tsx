'use client';

import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchWhatsMissed, hasStoredSession, markDiscoverySeen } from '@/lib/discovery-client';

/**
 * The return-loop surface — "here's what happened since you were last here," plus the
 * streak signal. See docs/PHASE6_RETENTION_SOCIAL.md#return-loop. A thin read over the
 * existing Notification table (no new event model). Renders nothing for an anonymous
 * visitor or a viewer with nothing new — same "this section simply doesn't exist" choice
 * PersonalizedSection makes; a quiet product beats a nagging one.
 *
 * Order matters: this fetches whatsMissed() (scoped to `createdAt > lastDiscoverySeenAt`)
 * *before* calling markDiscoverySeen(), so the items shown are always what happened before
 * this visit — marking seen only affects what the *next* visit will show.
 */
export function WhatsMissedSection() {
  const [state, setState] = useState<'hidden' | 'loading' | 'shown'>('hidden');
  const [summary, setSummary] = useState<{ count: number; streak: number } | null>(null);

  useEffect(() => {
    if (!hasStoredSession()) return;
    setState('loading');
    let cancelled = false;
    fetchWhatsMissed()
      .then((result) => {
        if (cancelled || !result) return;
        if (result.totalUnseen > 0) {
          setSummary({ count: result.totalUnseen, streak: result.currentStreakDays });
          setState('shown');
        } else {
          setState('hidden');
        }
        // Advance the streak / reset the "missed" window for next time regardless of
        // whether there was anything to show this visit.
        void markDiscoverySeen();
      })
      .catch(() => setState('hidden'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== 'shown' || !summary) return null;

  return (
    <Surface className="mb-8 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-lg">
          🔔
        </span>
        <p className="font-body text-sm text-ink-900">
          <span className="font-semibold">
            {summary.count} {summary.count === 1 ? 'thing' : 'things'}
          </span>{' '}
          happened since your last visit.
        </p>
      </div>
      <div className="flex items-center gap-4">
        {summary.streak > 1 && (
          <span
            className="font-mono text-xs text-ink-400"
            title="Consecutive days you've checked in"
          >
            🔥 {summary.streak}-day streak
          </span>
        )}
        <Link href="/notifications" className="font-mono text-xs text-accent hover:opacity-80">
          View all
        </Link>
      </div>
    </Surface>
  );
}
