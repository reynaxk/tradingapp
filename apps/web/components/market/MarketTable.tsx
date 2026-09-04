import type { MarketSummary } from '@fomo/domain';
import Link from 'next/link';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { EmptyState } from './EmptyState';
import { PriceChange } from './PriceChange';
import { StaleBadge } from './StaleBadge';
import { TokenIdentity } from './TokenIdentity';

export function MarketTable({ markets }: { markets: MarketSummary[] }) {
  if (markets.length === 0) {
    return (
      <EmptyState
        title="No market data available yet"
        detail="The ingestion worker hasn't published a priced snapshot for any tracked market. Check back shortly."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[0.7rem] uppercase tracking-wide text-ink-400">
            <th className="px-4 py-3 font-medium">Token</th>
            <th className="px-4 py-3 text-right font-medium">Price</th>
            <th className="px-4 py-3 text-right font-medium">24H</th>
            <th className="px-4 py-3 text-right font-medium">Volume</th>
            <th className="px-4 py-3 text-right font-medium">Liquidity</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => (
            <tr key={market.tokenAddress} className="group border-b border-line last:border-0">
              <td className="p-0">
                <Link
                  href={`/market/${market.tokenAddress}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors group-hover:bg-surface-raised"
                >
                  <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="sm" />
                  {market.isStale && <StaleBadge />}
                </Link>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-900">
                {formatPrice(market.priceUsd)}
              </td>
              <td className="px-4 py-3 text-right">
                <PriceChange value={market.priceChange24hPct} />
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-600">
                {formatCompactUsd(market.volume24hUsd)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-600">
                {formatCompactUsd(market.liquidityUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
