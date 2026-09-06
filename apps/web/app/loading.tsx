import { Skeleton } from '@/components/market/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>

      <Skeleton className="mt-12 h-7 w-48" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-12 w-full rounded-xl" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>

      <Skeleton className="mt-12 h-5 w-24" />
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
