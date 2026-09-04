import { cn } from '@fomo/ui';

/**
 * No token in Phase 1 has a `logoUrl` — see docs/MARKET_DATA.md#token-discovery, the
 * ingestion worker only ever reads symbol/name/decimals from the contract, and there is
 * no honest on-chain source for a logo. This renders a plain `<img>` (not next/image,
 * which needs a configured remote-pattern allowlist we don't have a real domain for yet)
 * for the day a genuine source exists, and an initials avatar otherwise — never a
 * fabricated placeholder image.
 */
export function TokenIdentity({
  symbol,
  name,
  logoUrl,
  size = 'md',
}: {
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const display = symbol ?? name ?? '?';
  const dims = size === 'lg' ? 'h-11 w-11 text-base' : size === 'sm' ? 'h-7 w-7 text-[0.65rem]' : 'h-9 w-9 text-xs';

  return (
    <div className="flex min-w-0 items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className={cn('shrink-0 rounded-full object-cover', dims)} />
      ) : (
        <div
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display font-bold text-accent',
            dims,
          )}
        >
          {display.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-display text-sm font-semibold text-ink-900">{symbol ?? '—'}</div>
        {name && <div className="truncate font-body text-xs text-ink-400">{name}</div>}
      </div>
    </div>
  );
}
