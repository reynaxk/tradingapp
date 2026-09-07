'use client';

import { useState } from 'react';
import { cn } from '@fomo/ui';
import { isValidSlippageBps, TRADING_DEFAULTS } from '@fomo/domain';

const PRESETS_BPS = [10, 50, 100]; // 0.1% / 0.5% / 1%

function formatBpsAsPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

/**
 * Explicit slippage control — see docs/TRADING.md#slippage. Presets cover the common
 * cases; "Custom" is clamped to the same [minSlippageBps, maxSlippageBps] bounds the API
 * itself enforces (see QuoteQueryDto), so a user can never even attempt an unsafe value —
 * there is no way to submit an "unlimited slippage" request from this UI.
 */
export function SlippageControl({ valueBps, onChange }: { valueBps: number; onChange: (bps: number) => void }) {
  const isPreset = PRESETS_BPS.includes(valueBps);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [customInput, setCustomInput] = useState(isPreset ? '' : (valueBps / 100).toString());

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-body text-xs text-ink-600">Slippage tolerance</span>
        <span className="font-mono text-xs text-ink-600">{formatBpsAsPercent(valueBps)}</span>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {PRESETS_BPS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setCustomOpen(false);
              onChange(preset);
            }}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-medium transition-colors',
              !customOpen && valueBps === preset ? 'bg-accent text-white' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
            )}
          >
            {formatBpsAsPercent(preset)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className={cn(
            'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-medium transition-colors',
            customOpen ? 'bg-accent text-white' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
          )}
        >
          Custom
        </button>
      </div>
      {customOpen && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={customInput}
            placeholder={`${TRADING_DEFAULTS.minSlippageBps / 100}–${TRADING_DEFAULTS.maxSlippageBps / 100}`}
            onChange={(event) => {
              const raw = event.target.value;
              setCustomInput(raw);
              const percent = Number.parseFloat(raw);
              if (Number.isFinite(percent)) {
                const bps = Math.round(percent * 100);
                if (isValidSlippageBps(bps)) onChange(bps);
              }
            }}
            className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-xs text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="font-body text-xs text-ink-600">%</span>
        </div>
      )}
      {/* A UI-only heuristic (not a server-enforced threshold) — the API's actual bound is
          TRADING_DEFAULTS.maxSlippageBps, enforced regardless of this warning. */}
      {valueBps >= 300 && (
        <p className="mt-1 font-body text-xs text-down">A high slippage tolerance can expose this trade to sandwich attacks.</p>
      )}
    </div>
  );
}
