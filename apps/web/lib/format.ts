/** Formatting only — no fetching, no state. Kept pure so it's trivially unit-testable. */

const EM_DASH = '—';

/**
 * Prices in this product range from ~$100,000 (cbBTC) to fractions of a cent (meme
 * tokens) — a fixed decimal count would either truncate the second case to "$0.00" or
 * pad the first with meaningless zeros. Scales precision to the magnitude instead.
 */
export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  if (value === 0) return '$0.00';
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Compact USD for volume/liquidity/market cap — "$1.24M", "$803.5K", "$42.00". */
export function formatCompactUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** "+12.34%" / "-5.67%" — the sign is always shown so a glance can tell direction. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export type PriceDirection = 'up' | 'down' | 'flat';

export function priceDirection(value: number | null): PriceDirection {
  if (value === null || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** Address -> "0x4200…0006" for compact display; the full value stays in the title attr. */
export function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Explicit locale — never the server process's own locale, which varies by host and
 *  would otherwise make this render differently in production than in development. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
