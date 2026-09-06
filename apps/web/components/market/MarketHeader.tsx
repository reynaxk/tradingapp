import Link from 'next/link';
import { SearchBar } from './SearchBar';

/**
 * "Discover" is the one top-level nav destination — trader profiles (`/trader/[address]`)
 * are real as of Phase 2, but reached from activity/search/follows rather than a top-level
 * link, since there's no trader *listing* page to point a nav item at yet.
 */
export function MarketHeader({ searchValue }: { searchValue?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            🔥
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-ink-900">Fomo</span>
        </Link>
        <span className="rounded-full bg-accent/10 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wide text-accent">
          Discover
        </span>
        <div className="ml-auto">
          <SearchBar defaultValue={searchValue} />
        </div>
      </div>
    </header>
  );
}
