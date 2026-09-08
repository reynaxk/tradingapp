import { MarketHeader } from '@/components/market/MarketHeader';
import { WatchlistView } from '@/components/watchlist/WatchlistView';

export const metadata = { title: 'Your watchlist — Fomo' };

/**
 * Entirely client-rendered below the header — a watchlist is personal to whatever session
 * this browser has (see docs/PHASE6_RETENTION_SOCIAL.md#watchlists), which a Server Component
 * structurally cannot see (the session lives in localStorage, never a cookie). "These are the
 * things I care about right now" — see docs/PHASE6_RETENTION_SOCIAL.md#web-ux.
 */
export default function WatchlistPage() {
  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-xl font-bold text-ink-900">Your watchlist</h1>
        <p className="mt-1 font-body text-sm text-ink-600">Tokens you&apos;re tracking, newest first.</p>
        <div className="mt-6">
          <WatchlistView />
        </div>
      </main>
    </>
  );
}
