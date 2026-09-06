import { AutoRefresh } from '@/components/market/AutoRefresh';
import { EmptyState } from '@/components/market/EmptyState';
import { MarketHeader } from '@/components/market/MarketHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TokenCard } from '@/components/market/TokenCard';
import { fetchDiscoverMarkets } from '@/lib/market-api';

export const revalidate = 20;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const search = searchParams.search?.trim() || undefined;

  const [ranked, trending, byVolume] = await Promise.all([
    fetchDiscoverMarkets({ sort: 'score', limit: 20, search }),
    fetchDiscoverMarkets({ sort: 'priceChange', limit: 3, search }),
    fetchDiscoverMarkets({ sort: 'volume', limit: 3, search }),
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

        <section className="mb-12">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">What&apos;s moving</h1>
          <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
            Ranked by the Discovery Score — a transparent mix of volume, momentum, and liquidity. See how it&apos;s
            computed in the token detail page.
          </p>
          <div className="mt-5">
            <MarketTable markets={ranked} />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Trending</h2>
          <p className="mt-1 font-body text-sm text-ink-600">Biggest 24h movers among tracked markets.</p>
          <div className="mt-5">
            {trending.length === 0 ? (
              <EmptyState title="No trending data yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {trending.map((market) => (
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
