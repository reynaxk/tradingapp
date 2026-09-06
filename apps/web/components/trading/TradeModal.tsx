'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet on mobile, centered modal on larger screens — see
 * docs/TRADING.md#trading-ui's mobile requirement. One shell reused by every entry point
 * (token page, activity "Trade" action) so the trading experience is identical regardless
 * of where it was opened from.
 */
export function TradeModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-xl sm:max-w-md sm:rounded-2xl sm:p-5"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
