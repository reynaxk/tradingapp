import { cn } from '@fomo/ui';
import { truncateAddress } from '@/lib/format';

/**
 * Mirrors TokenIdentity's honesty rule: a real `<img>` when we have one, an initials avatar
 * otherwise — never a fabricated placeholder image. Almost every trader in Phase 2 has no
 * `displayName`/`avatarUrl` yet (no wallet-linking — see docs/SOCIAL.md#trader-identity),
 * so the truncated address carries the identity most of the time, by design.
 */
export function TraderIdentity({
  address,
  displayName,
  avatarUrl,
  size = 'md',
}: {
  address: string;
  displayName: string | null;
  avatarUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const label = displayName ?? truncateAddress(address);
  const initials = (displayName ?? address.slice(2)).slice(0, 2).toUpperCase();
  const dims = size === 'lg' ? 'h-11 w-11 text-base' : size === 'sm' ? 'h-7 w-7 text-[0.65rem]' : 'h-9 w-9 text-xs';

  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className={cn('shrink-0 rounded-full object-cover', dims)} />
      ) : (
        <div
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display font-bold text-accent',
            dims,
          )}
        >
          {initials}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-display text-sm font-semibold text-ink-900">{label}</div>
        {displayName && <div className="truncate font-mono text-xs text-ink-400">{truncateAddress(address)}</div>}
      </div>
    </div>
  );
}
