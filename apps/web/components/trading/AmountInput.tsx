'use client';

import { cn } from '@fomo/ui';
import { formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';

const PRESET_FRACTIONS = [0.25, 0.5, 1] as const;

/**
 * Amount presets are fractions of the connected wallet's *real* balance of the input token
 * for this side (read live from-chain via wagmi, never assumed) — never a fixed dollar
 * amount, since Fomo doesn't have a live USD conversion input here and a hardcoded
 * "$10/$50/$100" would be meaningless for an 18-decimal token priced at a fraction of a
 * cent. See docs/TRADING.md#trading-ui.
 */
export function AmountInput({
  value,
  onChange,
  inputTokenAddress,
  inputTokenSymbol,
  inputTokenDecimals,
}: {
  value: string;
  onChange: (value: string) => void;
  inputTokenAddress: string;
  inputTokenSymbol: string | null;
  inputTokenDecimals: number;
}) {
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: inputTokenAddress as `0x${string}`,
    query: { refetchInterval: 15_000 },
  });

  const applyFraction = (fraction: number) => {
    if (!balance) return;
    const raw = (balance.value * BigInt(Math.round(fraction * 10_000))) / 10_000n;
    onChange(formatUnits(raw, inputTokenDecimals));
  };

  return (
    <div>
      <div className="flex items-center justify-between font-body text-xs text-ink-600">
        <span>Amount ({inputTokenSymbol ?? 'token'})</span>
        {balance && <span>Balance: {Number(formatUnits(balance.value, inputTokenDecimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>}
      </div>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '' || /^\d*\.?\d*$/.test(raw)) onChange(raw);
        }}
        className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-lg text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-1.5 flex gap-1.5">
        {PRESET_FRACTIONS.map((fraction) => (
          <button
            key={fraction}
            type="button"
            disabled={!balance || balance.value === 0n}
            onClick={() => applyFraction(fraction)}
            className={cn(
              'flex-1 rounded-lg bg-surface-raised px-2 py-1.5 font-body text-xs font-medium text-ink-600',
              'hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {fraction === 1 ? 'Max' : `${fraction * 100}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
