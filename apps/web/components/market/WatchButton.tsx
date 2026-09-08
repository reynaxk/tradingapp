'use client';

import { cn } from '@fomo/ui';
import { useEffect, useState, useTransition, type MouseEvent } from 'react';
import { checkWatchStatus, unwatchToken, watchToken } from '@/lib/watchlist-client';

/**
 * ☆ Watch / ★ Watching — see docs/PHASE6_RETENTION_SOCIAL.md#watchlists. Same
 * optimistic-toggle-with-rollback shape as FollowButton: `initialWatching` from a
 * server-rendered page is always `null` (the session lives in localStorage, a Server
 * Component can never see it), so it's resolved once mounted using whatever session this
 * browser already has, without creating a new one just to check.
 *
 * `compact` renders an icon-only star (for TokenCard grids) instead of the labeled pill
 * used on the token detail page — the icon still carries a real `aria-label` and
 * `aria-pressed`, so it's never icon-only for a screen reader.
 */
export function WatchButton({
  address,
  initialWatching,
  compact = false,
  className,
  onChange,
}: {
  address: string;
  initialWatching: boolean | null;
  compact?: boolean;
  className?: string;
  /** Fires with the confirmed (server-accepted) next state — never the optimistic guess, so
   *  a caller that removes a row on `false` (see WatchlistView) never removes it only to have
   *  the mutation fail and need to reinsert it. */
  onChange?: (watching: boolean) => void;
}) {
  const [watching, setWatching] = useState(initialWatching === true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initialWatching !== null) return;
    let cancelled = false;
    checkWatchStatus(address).then((isWatching) => {
      if (!cancelled) setWatching(isWatching);
    });
    return () => {
      cancelled = true;
    };
  }, [address, initialWatching]);

  function toggle(event?: MouseEvent) {
    event?.preventDefault(); // compact star sits inside a card-level <Link> — never navigate
    event?.stopPropagation();
    const next = !watching;
    setWatching(next);
    setError(false);
    startTransition(async () => {
      try {
        await (next ? watchToken(address) : unwatchToken(address));
        onChange?.(next);
      } catch {
        setWatching(!next); // roll back — the server never confirmed this state
        setError(true);
      }
    });
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={watching}
        aria-label={watching ? `Stop watching ${address}` : `Watch ${address}`}
        title={watching ? 'Watching' : 'Watch'}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          watching ? 'text-accent' : 'text-ink-400 hover:text-ink-900',
          isPending && 'opacity-50',
          className,
        )}
      >
        <span aria-hidden>{watching ? '★' : '☆'}</span>
      </button>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={watching}
        className={cn(
          'inline-flex min-w-[7rem] items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold',
          'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          watching
            ? 'bg-surface-raised text-ink-900 hover:bg-line'
            : 'bg-transparent text-ink-600 ring-1 ring-inset ring-line hover:text-ink-900',
        )}
      >
        <span aria-hidden>{watching ? '★' : '☆'}</span>
        {watching ? 'Watching' : 'Watch'}
      </button>
      {error && (
        <p className="mt-1 font-body text-xs text-down">Couldn&apos;t save that — try again.</p>
      )}
    </div>
  );
}
