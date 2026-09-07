import Link from 'next/link';
import { MarketHeader } from '@/components/market/MarketHeader';
import { TransactionDetail } from '@/components/trading/TransactionDetail';

export const metadata = { title: 'Trade detail — Fomo' };

export default function TradeDetailPage({ params }: { params: { id: string } }) {
  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/trades" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to your trades
        </Link>
        <div className="mt-4">
          <TransactionDetail id={params.id} />
        </div>
      </main>
    </>
  );
}
