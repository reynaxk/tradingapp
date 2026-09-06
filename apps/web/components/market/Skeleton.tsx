import { cn } from '@fomo/ui';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-raised', className)} />;
}
