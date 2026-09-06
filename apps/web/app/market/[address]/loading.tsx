import { Skeleton } from '@/components/market/Skeleton';

export default function TokenLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex items-center gap-4">
        <Skeleton className="h-11 w-11 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <Skeleton className="mt-6 h-9 w-48" />
      <div className="mt-6 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-8 h-72 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
    </div>
  );
}
