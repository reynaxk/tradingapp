import { Surface } from '@fomo/ui';

export function FoundationTile({ name, detail }: { name: string; detail: string }) {
  return (
    <Surface className="p-5">
      <div className="font-mono text-xs uppercase tracking-wide text-accent">{name}</div>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{detail}</p>
    </Surface>
  );
}
