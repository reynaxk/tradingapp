import type { RisingTrader, RisingToken } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { EmptyState } from '@/components/market/EmptyState';
import { TokenCard } from '@/components/market/TokenCard';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { formatRelativeTime } from '@/lib/format';

/**
 * "Rising" — a measurable increase in activity, never a vibe. Tokens are ones that
 * recently entered trending (reusing Phase 4's own trending-transition state — see
 * isRecentlyRisingToken in @fomo/domain); traders are ones trading well above their own
 * historical pace (see isRisingTrader). See docs/TRADER_INTELLIGENCE.md#rising.
 */
export function RisingSection({ tokens, traders }: { tokens: RisingToken[]; traders: RisingTrader[] }) {
  if (tokens.length === 0 && traders.length === 0) {
    return <EmptyState title="Nothing is rising right now." detail="Check back once more tokens or traders pick up pace." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {tokens.length > 0 && (
        <div>
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-ink-400">Tokens</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((item) => (
              <div key={item.market.tokenAddress} className="flex flex-col gap-2">
                <TokenCard market={item.market} />
                <p className="px-1 font-mono text-[0.65rem] text-ink-400">
                  Started trending {formatRelativeTime(item.becameTrendingAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {traders.length > 0 && (
        <div>
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-ink-400">Traders</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {traders.map((trader) => (
              <Link key={trader.address} href={`/trader/${trader.address}`} className="block">
                <Surface className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent/50 hover:bg-surface-raised">
                  <TraderIdentity address={trader.address} displayName={trader.displayName} avatarUrl={trader.avatarUrl} />
                  <p className="mt-auto border-t border-line pt-3 font-mono text-xs text-ink-600">
                    {trader.tradeCount24h} trades today — well above their usual pace
                  </p>
                </Surface>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
