import type { TradeStatus } from '@fomo/domain';
import { cn } from '@fomo/ui';

const LABEL: Record<TradeStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

const CLASS: Record<TradeStatus, string> = {
  PENDING: 'bg-ink-400/10 text-ink-600',
  CONFIRMED: 'bg-up/10 text-up',
  FAILED: 'bg-down/10 text-down',
  EXPIRED: 'bg-down/10 text-down',
};

/** Reflects exactly what the API's own status enum says — see
 *  docs/TRADING.md#transaction-lifecycle. Never a client-guessed state. */
export function StatusPill({ status }: { status: TradeStatus }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wide', CLASS[status])}>
      {LABEL[status]}
    </span>
  );
}
