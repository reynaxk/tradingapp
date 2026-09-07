import type { TokenTraderConnection } from '@fomo/domain';
import Link from 'next/link';
import { EmptyState } from '@/components/market/EmptyState';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { formatRelativeTime } from '@/lib/format';

/** Token → trader connection — see docs/TRADER_INTELLIGENCE.md#token-to-trader. Reuses the
 *  same TraderIdentity avatar/name rendering as everywhere else a trader appears. */
export function TokenTradersPanel({ connection }: { connection: TokenTraderConnection }) {
  if (connection.recentTraders.length === 0) {
    return <EmptyState title="No traders indexed yet." detail="Recent traders on this token will show up here." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {connection.uniqueTraders24h !== null && (
        <p className="font-mono text-xs text-ink-400">
          <span className="font-semibold text-ink-900">{connection.uniqueTraders24h}</span> unique traders in the last 24h
        </p>
      )}

      <div>
        <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-ink-400">Recently active</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {connection.recentTraders.map((trader) => (
            <Link key={trader.address} href={`/trader/${trader.address}`} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent/50 hover:bg-surface-raised">
              <TraderIdentity address={trader.address} displayName={trader.displayName} avatarUrl={trader.avatarUrl} size="sm" />
              <time className="shrink-0 font-mono text-[0.65rem] text-ink-400">{formatRelativeTime(trader.lastTradeAt)}</time>
            </Link>
          ))}
        </div>
      </div>

      {connection.activeTraders.length > 0 && (
        <div>
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-ink-400">Most active today</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {connection.activeTraders.map((trader) => (
              <Link key={trader.address} href={`/trader/${trader.address}`} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent/50 hover:bg-surface-raised">
                <TraderIdentity address={trader.address} displayName={trader.displayName} avatarUrl={trader.avatarUrl} size="sm" />
                <span className="shrink-0 font-mono text-[0.65rem] text-ink-400">{trader.tradeCount24h} trades</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
