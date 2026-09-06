export function StaleBadge() {
  return (
    <span
      title="This price hasn't updated recently — showing the last known value."
      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-raised px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide text-ink-400"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-400" />
      Stale
    </span>
  );
}
