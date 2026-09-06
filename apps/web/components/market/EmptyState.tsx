export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <p className="font-display text-sm font-semibold text-ink-600">{title}</p>
      {detail && <p className="max-w-sm font-body text-sm text-ink-400">{detail}</p>}
    </div>
  );
}
