import { Skeleton } from '@/components/market/Skeleton';

export default function TraderLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-8 h-96 w-full rounded-2xl" />
    </div>
  );
}
