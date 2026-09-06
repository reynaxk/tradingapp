/**
 * A plain GET form, not a client-side typeahead — search is server-backed (see
 * docs/MARKET_DATA.md#search), and a full round trip through the Discover page's own
 * data fetch is simpler and just as fast at Phase 1's scale than standing up a separate
 * client-exposed search endpoint. No client JS required for this to work at all.
 */
export function SearchBar({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action="/" method="get" role="search" className="w-full max-w-xs">
      <label htmlFor="market-search" className="sr-only">
        Search tokens by symbol, name, or contract address
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent">
        <svg aria-hidden width="15" height="15" viewBox="0 0 15 15" className="shrink-0 text-ink-400">
          <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <line x1="10.2" y1="10.2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          id="market-search"
          name="search"
          type="text"
          placeholder="Search symbol, name, or address"
          defaultValue={defaultValue}
          autoComplete="off"
          className="w-full bg-transparent font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
      </div>
    </form>
  );
}
