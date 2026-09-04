import { priceDirection } from '@/lib/format';

const WIDTH = 96;
const HEIGHT = 32;
const PAD = 2;

/** Renders nothing (not a flat fake line) when there isn't enough real history to draw. */
export function Sparkline({ closes }: { closes: number[] }) {
  if (closes.length < 2) {
    return (
      <div className="flex h-8 w-24 items-center justify-center font-mono text-[0.65rem] text-ink-400">
        no history
      </div>
    );
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (WIDTH - PAD * 2) / (closes.length - 1);

  const points = closes.map((value, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - (value - min) / range) * (HEIGHT - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const direction = priceDirection(closes[closes.length - 1]! - closes[0]!);
  const strokeClass = direction === 'up' ? 'stroke-up' : direction === 'down' ? 'stroke-down' : 'stroke-ink-400';

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="overflow-visible" role="img" aria-label="Price trend">
      <polyline points={points.join(' ')} fill="none" className={strokeClass} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
