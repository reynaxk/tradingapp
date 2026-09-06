import type { TopTrader } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { formatCompactUsd } from '@/lib/format';
import { TraderIdentity } from './TraderIdentity';

/** "Most Active" by real, measured 24h volume — never "smart money" or "profitable" (see
 *  the TopTrader comment in packages/domain/src/wallet.ts for why). */
export function TopTraders({ traders }: { traders: TopTrader[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {traders.map((trader) => (
        <Link key={trader.address} href={`/trader/${trader.address}`} className="block">
          <Surface className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent/50 hover:bg-surface-raised">
            <TraderIdentity address={trader.address} displayName={trader.displayName} avatarUrl={trader.avatarUrl} />
            <div className="mt-auto flex items-center justify-between border-t border-line pt-3 font-mono text-xs tabular-nums text-ink-600">
              <div>
                <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">24h volume</div>
                {formatCompactUsd(trader.volumeUsd)}
              </div>
              <div className="text-right">
                <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">Trades</div>
                {trader.tradeCount}
              </div>
            </div>
          </Surface>
        </Link>
      ))}
    </div>
  );
}
