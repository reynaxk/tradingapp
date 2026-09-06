import { TIMEFRAMES, type Timeframe } from '@fomo/domain';
import { cn } from '@fomo/ui';
import Link from 'next/link';

/** Plain links updating ?timeframe= — each tab is a real server-rendered page, no client state. */
export function TimeframeTabs({ address, active }: { address: string; active: Timeframe }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-1">
      {TIMEFRAMES.map((tf) => (
        <Link
          key={tf}
          href={`/market/${address}?timeframe=${tf}`}
          className={cn(
            'rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors',
            tf === active ? 'bg-accent text-white' : 'text-ink-400 hover:text-ink-900',
          )}
        >
          {tf}
        </Link>
      ))}
    </div>
  );
}
