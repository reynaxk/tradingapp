import type { TraderTokenStat } from '@fomo/domain';
import Link from 'next/link';
import { EmptyState } from '@/components/market/EmptyState';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { formatCompactUsd, formatRelativeTime } from '@/lib/format';

/** Trader → token connection — see docs/TRADER_INTELLIGENCE.md#trader-to-token. */
export function TraderTokensList({ tokens }: { tokens: TraderTokenStat[] }) {
  if (tokens.length === 0) {
    return <EmptyState title="No tokens traded yet." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {tokens.map((entry) => (
        <Link
          key={entry.token.address}
          href={`/market/${entry.token.address}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent/50 hover:bg-surface-raised"
        >
          <TokenIdentity symbol={entry.token.symbol} name={entry.token.name} logoUrl={entry.token.logoUrl} size="sm" />
          <div className="flex shrink-0 items-center gap-4 font-mono text-xs tabular-nums text-ink-600">
            <div className="text-right">
              <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">Trades</div>
              {entry.tradeCount}
            </div>
            <div className="text-right">
              <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">Volume</div>
              {formatCompactUsd(entry.volumeUsd)}
            </div>
            <div className="text-right text-ink-400">{formatRelativeTime(entry.lastActivityAt)}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
