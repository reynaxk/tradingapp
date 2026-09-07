import { TIMEFRAMES, type Timeframe } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/market/AutoRefresh';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PriceChange } from '@/components/market/PriceChange';
import { PriceChart } from '@/components/market/PriceChart';
import { StaleBadge } from '@/components/market/StaleBadge';
import { TimeframeTabs } from '@/components/market/TimeframeTabs';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { ActivityFeed } from '@/components/social/ActivityFeed';
import { TradeButton } from '@/components/trading/TradeButton';
import { formatCompactUsd, formatDateTime, formatPrice, truncateAddress } from '@/lib/format';
import { fetchToken, fetchTokenHistory } from '@/lib/market-api';
import { fetchGlobalActivity } from '@/lib/social-api';

export const revalidate = 15;

function isTimeframe(value: string | undefined): value is Timeframe {
  return TIMEFRAMES.includes(value as Timeframe);
}

export default async function TokenDetailPage({
  params,
  searchParams,
}: {
  params: { address: string };
  searchParams: { timeframe?: string };
}) {
  const timeframe: Timeframe = isTimeframe(searchParams.timeframe) ? searchParams.timeframe : '1D';

  const market = await fetchToken(params.address);
  if (!market) notFound();

  const candles = await fetchTokenHistory(params.address, timeframe);
  const activity = await fetchGlobalActivity({ tokenAddress: params.address, limit: 10 });

  return (
    <>
      <AutoRefresh intervalSeconds={20} />
      <MarketHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to Discover
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="lg" />
            <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wide text-ink-400">
              {market.chainIdentifier}
            </span>
          </div>
          {market.isStale && <StaleBadge />}
        </div>

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums text-ink-900">
            {formatPrice(market.priceUsd)}
          </span>
          <PriceChange value={market.priceChange24hPct} className="text-base" />
        </div>

        {market.decimals !== null && market.quoteDecimals !== null && (
          <div className="mt-4 flex gap-3">
            <TradeButton
              side="BUY"
              variant="primary"
              className="flex-1"
              tokenAddress={market.tokenAddress}
              tokenSymbol={market.symbol}
              tokenDecimals={market.decimals}
              quoteTokenAddress={market.quoteAddress}
              quoteTokenSymbol={market.quoteSymbol}
              quoteTokenDecimals={market.quoteDecimals}
            />
            <TradeButton
              side="SELL"
              variant="secondary"
              className="flex-1"
              tokenAddress={market.tokenAddress}
              tokenSymbol={market.symbol}
              tokenDecimals={market.decimals}
              quoteTokenAddress={market.quoteAddress}
              quoteTokenSymbol={market.quoteSymbol}
              quoteTokenDecimals={market.quoteDecimals}
            />
          </div>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat
            label="FDV"
            value={formatCompactUsd(market.marketCapUsd)}
            title="Fully diluted value — token price × total on-chain supply, not circulating market cap. See docs/MARKET_DATA.md."
          />
          <Stat label="Volume 24h" value={formatCompactUsd(market.volume24hUsd)} />
          <Stat label="Liquidity" value={formatCompactUsd(market.liquidityUsd)} />
        </div>

        <Surface className="mt-8 p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-900">Price chart</h2>
            <TimeframeTabs address={params.address} active={timeframe} />
          </div>
          <PriceChart candles={candles} />
        </Surface>

        <Surface className="mt-6 p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">
            Who&apos;s trading {market.symbol ?? 'this'}
          </h2>
          <ActivityFeed
            initialItems={activity.items}
            initialCursor={activity.nextCursor}
            scope={{ type: 'token', address: params.address }}
            emptyTitle="No activity indexed yet."
            emptyDetail="Real trades on this market will show up here as they're indexed."
          />
        </Surface>

        <Surface className="mt-6 p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">Market data</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DataRow label="Contract" value={market.tokenAddress} mono title={market.tokenAddress} truncate />
            <DataRow label="Decimals" value={market.decimals?.toString() ?? '—'} mono />
            <DataRow label="Quote token" value={market.quoteSymbol ?? '—'} />
            <DataRow label="DEX" value={market.dex ?? '—'} />
            <DataRow label="Fee tier" value={market.feeTier !== null ? `${market.feeTier / 10_000}%` : '—'} />
            <DataRow
              label="Last updated"
              value={market.lastPriceUpdateAt ? formatDateTime(market.lastPriceUpdateAt) : 'never'}
            />
          </dl>
        </Surface>
      </main>
    </>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4" title={title}>
      <div className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}

function DataRow({
  label,
  value,
  mono,
  truncate,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-2 last:border-0 sm:last:border-b">
      <dt className="font-body text-sm text-ink-400">{label}</dt>
      <dd
        title={title}
        className={
          mono
            ? `font-mono text-sm text-ink-900 ${truncate ? 'max-w-[10rem] truncate' : ''}`
            : 'font-body text-sm text-ink-900'
        }
      >
        {truncate ? truncateAddress(value) : value}
      </dd>
    </div>
  );
}
