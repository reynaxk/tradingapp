import { MarketHeader } from '@/components/market/MarketHeader';
import { TradeHistoryList } from '@/components/trading/TradeHistoryList';

export const metadata = { title: 'Your trades — Fomo' };

/**
 * Entirely client-rendered below the header — trade history is personal to whatever
 * session/wallet this browser has (see docs/TRADING.md#authorization), which a Server
 * Component structurally cannot see (the session lives in localStorage, never a cookie).
 */
export default function TradesPage() {
  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-xl font-bold text-ink-900">Your trades</h1>
        <p className="mt-1 font-body text-sm text-ink-600">Only trades made from a wallet you&apos;ve verified in this browser.</p>
        <div className="mt-6">
          <TradeHistoryList />
        </div>
      </main>
    </>
  );
}
