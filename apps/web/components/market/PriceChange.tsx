import { cn } from '@fomo/ui';
import { formatPercent, priceDirection } from '@/lib/format';

export function PriceChange({ value, className }: { value: number | null; className?: string }) {
  const direction = priceDirection(value);
  return (
    <span
      className={cn(
        'font-mono text-sm tabular-nums',
        direction === 'up' && 'text-up',
        direction === 'down' && 'text-down',
        direction === 'flat' && 'text-ink-400',
        className,
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
