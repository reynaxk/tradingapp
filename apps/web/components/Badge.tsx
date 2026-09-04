import { cn } from '@fomo/ui';
import type { HTMLAttributes } from 'react';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1',
        'font-mono text-[0.7rem] uppercase tracking-wide text-ink-600',
        className,
      )}
      {...props}
    />
  );
}
