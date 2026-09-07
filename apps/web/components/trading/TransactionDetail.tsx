'use client';

import type { TradeTransactionDto } from '@fomo/domain';
import { Surface } from '@fomo/ui';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { formatDateTime, truncateAddress } from '@/lib/format';
import { getTransaction } from '@/lib/trading-client';
import { StatusPill } from './StatusPill';

type State = 'loading' | 'loaded' | 'not-found' | 'error';

/** Fee/price/status/explorer-link for one trade — see docs/TRADING.md#transaction-lifecycle.
 *  Polls while PENDING so a page left open catches the real confirmation without a reload. */
export function TransactionDetail({ id }: { id: string }) {
  const [state, setState] = useState<State>('loading');
  const [transaction, setTransaction] = useState<TradeTransactionDto | null>(null);

  useEffect(() => {
    let cancelled = false;

    function stopPolling() {
      clearInterval(interval);
    }

    function load() {
      getTransaction(id)
        .then((result) => {
          if (cancelled) return;
          if (result === null) {
            setState('not-found');
            stopPolling();
            return;
          }
          setTransaction(result);
          setState('loaded');
          if (result.status !== 'PENDING') stopPolling();
        })
        .catch(() => {
          if (!cancelled) setState('error');
        });
    }

    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  if (state === 'loading') return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (state === 'not-found') return <EmptyState title="Trade not found." detail="This isn't one of your recorded trades." />;
  if (state === 'error' || !transaction) return <EmptyState title="Couldn't load this trade." detail="Try again in a moment." />;

  const outputSymbol = transaction.side === 'BUY' ? transaction.token.symbol : transaction.quoteToken.symbol;
  const inputSymbol = transaction.side === 'BUY' ? transaction.quoteToken.symbol : transaction.token.symbol;

  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-bold text-ink-900">
          {transaction.side === 'BUY' ? 'Bought' : 'Sold'} {transaction.token.symbol ?? truncateAddress(transaction.token.address)}
        </h1>
        <StatusPill status={transaction.status} />
      </div>

      <dl className="mt-4 space-y-2 font-body text-sm">
        <Row label="You paid" value={`${transaction.inputAmountFormatted} ${inputSymbol ?? ''}`} />
        <Row label="You received" value={`${transaction.expectedOutputAmountFormatted} ${outputSymbol ?? ''}`} />
        <Row label="Fomo fee" value={`${transaction.platformFeeAmountFormatted} ${outputSymbol ?? ''}`} />
        <Row label="Submitted" value={formatDateTime(transaction.submittedAt)} />
        {transaction.confirmedAt && <Row label="Confirmed" value={formatDateTime(transaction.confirmedAt)} />}
        {transaction.failureReason && <Row label="Reason" value={transaction.failureReason} />}
        <Row label="Chain" value={`eip155:${transaction.chainId}`} />
      </dl>

      <a
        href={`https://basescan.org/tx/${transaction.txHash}`}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 inline-block font-mono text-xs text-accent underline"
      >
        View {truncateAddress(transaction.txHash)} on Basescan
      </a>
    </Surface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-ink-600">{label}</dt>
      <dd className="font-mono text-ink-900">{value}</dd>
    </div>
  );
}
