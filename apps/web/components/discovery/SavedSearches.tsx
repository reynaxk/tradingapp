'use client';

import type { SavedSearchDto } from '@fomo/domain';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  hasStoredSession,
} from '@/lib/discovery-client';

/**
 * Lightweight bookmarks of a search query — see docs/PHASE6_RETENTION_SOCIAL.md#saved-searches.
 * No stored result set, no scheduled re-run: a saved search is just a link back to `/?search=`.
 * Renders nothing for an anonymous visitor, same "this section simply doesn't exist" choice
 * PersonalizedSection makes.
 */
export function SavedSearches({ currentSearch }: { currentSearch?: string }) {
  const [hasSession, setHasSession] = useState(false);
  const [searches, setSearches] = useState<SavedSearchDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) return;
    setHasSession(true);
    fetchSavedSearches()
      .then((result) => {
        setSearches(result);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!hasSession) return null;

  const alreadySaved = currentSearch ? searches.some((s) => s.query === currentSearch) : true;

  async function saveCurrent() {
    if (!currentSearch) return;
    setSaving(true);
    try {
      const created = await createSavedSearch(currentSearch);
      setSearches((prev) => [created, ...prev]);
    } catch {
      // Leave the button available to retry — a failed save has nothing else to roll back.
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSearches((prev) => prev.filter((s) => s.id !== id)); // instant feel, no confirmation needed for a bookmark
    try {
      await deleteSavedSearch(id);
    } catch {
      // Nothing destructive happened server-side if this fails silently client-side beyond a
      // stale list; the next full load re-syncs it.
    }
  }

  if (!loaded) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {currentSearch && !alreadySaved && (
        <button
          type="button"
          onClick={() => void saveCurrent()}
          disabled={saving}
          className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-600 hover:text-ink-900 disabled:opacity-50"
        >
          {saving ? 'Saving…' : `☆ Save "${currentSearch}"`}
        </button>
      )}
      {searches.map((search) => (
        <span
          key={search.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 py-1 pl-3 pr-1.5 font-mono text-xs text-accent"
        >
          <Link href={`/?search=${encodeURIComponent(search.query)}`} className="hover:underline">
            {search.displayName ?? search.query}
          </Link>
          <button
            type="button"
            onClick={() => void remove(search.id)}
            aria-label={`Remove saved search "${search.displayName ?? search.query}"`}
            className="flex h-4 w-4 items-center justify-center rounded-full text-accent/70 hover:bg-accent/20 hover:text-accent"
          >
            <span aria-hidden>×</span>
          </button>
        </span>
      ))}
    </div>
  );
}
