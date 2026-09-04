import type { Candle } from '@fomo/domain';
import { formatPrice } from '@/lib/format';
import { EmptyState } from './EmptyState';

const WIDTH = 720;
const HEIGHT = 260;
const PAD_X = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

/**
 * A line/area chart over real persisted candle closes — no candlestick rendering (a
 * defensible Phase 1 simplification, not a data-honesty issue: OHLC is still returned by
 * the API and available to a future richer chart). Renders nothing fake when there isn't
 * enough history — see docs/MARKET_DATA.md#historical-data.
 */
export function PriceChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) {
    return (
      <EmptyState
        title="Not enough price history yet"
        detail="The ingestion worker is still building up real history for this market. Check back once it's had more time to index."
      />
    );
  }

  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || max || 1;
  const stepX = (WIDTH - PAD_X * 2) / (candles.length - 1);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const points = candles.map((candle, i) => {
    const x = PAD_X + i * stepX;
    const y = PAD_TOP + (1 - (candle.close - min) / range) * plotHeight;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]!.x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} L ${points[0]!.x.toFixed(1)} ${HEIGHT - PAD_BOTTOM} Z`;

  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const trendUp = last.close >= first.close;
  const strokeClass = trendUp ? 'stroke-up' : 'stroke-down';
  const fillId = trendUp ? 'fomo-chart-fill-up' : 'fomo-chart-fill-down';

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Price chart" className="overflow-visible">
        <defs>
          <linearGradient id="fomo-chart-fill-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-up" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="100%" className="text-up" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fomo-chart-fill-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-down" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="100%" className="text-down" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={PAD_TOP + t * plotHeight}
            y2={PAD_TOP + t * plotHeight}
            className="text-line"
            stroke="currentColor"
            strokeWidth={1}
          />
        ))}

        <path d={areaPath} fill={`url(#${fillId})`} stroke="none" />
        <path d={linePath} fill="none" className={strokeClass} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      <div className="mt-2 flex items-center justify-between font-mono text-xs text-ink-400">
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-ink-400">
        <span>{formatTimeLabel(first.bucketStart)}</span>
        <span>{formatTimeLabel(last.bucketStart)}</span>
      </div>
    </div>
  );
}

function formatTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
