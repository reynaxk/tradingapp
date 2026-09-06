import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { AutoRefresh } from '@/components/market/AutoRefresh';
import { EmptyState } from '@/components/market/EmptyState';
import { MarketHeader } from '@/components/market/MarketHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TokenCard } from '@/components/market/TokenCard';
import { ActivityFeedTabs } from '@/components/social/ActivityFeedTabs';
import { TopTraders } from '@/components/social/TopTraders';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { fetchDiscoverMarkets } from '@/lib/market-api';
import { fetchGlobalActivity, fetchTopTraders, fetchTraderSearch, fetchTrending } from '@/lib/social-api';

export const revalidate = 15;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const search = searchParams.search?.trim() || undefined;

  const [ranked, movers, byVolume, activity, trending, topTraders, traderResults] = await Promise.all([
    fetchDiscoverMarkets({ sort: 'score', limit: 20, search }),
    fetchDiscoverMarkets({ sort: 'priceChange', limit: 3, search }),
    fetchDiscoverMarkets({ sort: 'volume', limit: 3, search }),
    fetchGlobalActivity({ limit: 20 }),
    fetchTrending(6),
    fetchTopTraders(4),
    search ? fetchTraderSearch(search, 5) : Promise.resolve([]),
  ]);

  return (
    <>
      <AutoRefresh intervalSeconds={30} />
      <MarketHeader searchValue={search} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {search && (
          <p className="mb-6 font-body text-sm text-ink-600">
            Showing results for <span className="font-semibold text-ink-900">&ldquo;{search}&rdquo;</span>
          </p>
        )}

        {search && traderResults.length > 0 && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Traders</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {traderResults.map((trader) => (
                <Link key={trader.address} href={`/trader/${trader.address}`} className="block">
                  <Surface className="p-4 transition-colors hover:border-accent/50 hover:bg-surface-raised">
                    <TraderIdentity address={trader.address} displayName={trader.displayName} avatarUrl={trader.avatarUrl} />
                  </Surface>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!search && (
          <section className="mb-12">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Live activity</h1>
            <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
              Real indexed trades from tracked markets, as they happen. See who&apos;s buying and selling right now.
            </p>
            <div className="mt-5">
              <ActivityFeedTabs globalItems={activity.items} globalCursor={activity.nextCursor} />
            </div>
          </section>
        )}

        <section className="mb-12">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">What&apos;s moving</h2>
          <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
            Ranked by the Discovery Score — a transparent mix of volume, momentum, and liquidity. See how it&apos;s
            computed in the token detail page.
          </p>
          <div className="mt-5">
            <MarketTable markets={ranked} />
          </div>
        </section>

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Trending</h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Ranked by real trading activity — unique traders and trade count, not just volume. See
              docs/SOCIAL.md#trending.
            </p>
            <div className="mt-5">
              {trending.length === 0 ? (
                <EmptyState title="Nothing has cleared the trending thresholds yet" />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {trending.map((item) => (
                    <TokenCard key={item.market.tokenAddress} market={item.market} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Top traders</h2>
            <p className="mt-1 font-body text-sm text-ink-600">Most active by real 24h volume — not a profit claim.</p>
            <div className="mt-5">
              {topTraders.length === 0 ? (
                <EmptyState title="No trader has cleared the activity floor yet" />
              ) : (
                <TopTraders traders={topTraders} />
              )}
            </div>
          </section>
        )}

        <section className="mb-12">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Biggest movers</h2>
          <p className="mt-1 font-body text-sm text-ink-600">Biggest 24h movers among tracked markets.</p>
          <div className="mt-5">
            {movers.length === 0 ? (
              <EmptyState title="No movement data yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {movers.map((market) => (
                  <TokenCard key={market.tokenAddress} market={market} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Volume</h2>
          <p className="mt-1 font-body text-sm text-ink-600">Highest 24h trading volume among tracked markets.</p>
          <div className="mt-5">
            {byVolume.length === 0 ? (
              <EmptyState title="No volume data yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {byVolume.map((market) => (
                  <TokenCard key={market.tokenAddress} market={market} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
