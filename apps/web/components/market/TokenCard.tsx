import type { MarketSummary } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { PriceChange } from './PriceChange';
import { StaleBadge } from './StaleBadge';
import { TokenIdentity } from './TokenIdentity';

export function TokenCard({ market }: { market: MarketSummary }) {
  return (
    <Link href={`/market/${market.tokenAddress}`} className="block">
      <Surface className="flex h-full flex-col gap-4 p-5 transition-colors hover:border-accent/50 hover:bg-surface-raised">
        <div className="flex items-start justify-between gap-2">
          <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} />
          {market.isStale && <StaleBadge />}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="font-mono text-lg font-semibold tabular-nums text-ink-900">
              {formatPrice(market.priceUsd)}
            </div>
            <PriceChange value={market.priceChange24hPct} className="mt-1" />
          </div>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3 font-mono text-xs tabular-nums text-ink-600">
          <div>
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">Volume</div>
            {formatCompactUsd(market.volume24hUsd)}
          </div>
          <div className="text-right">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">Liquidity</div>
            {formatCompactUsd(market.liquidityUsd)}
          </div>
        </div>
      </Surface>
    </Link>
  );
}
