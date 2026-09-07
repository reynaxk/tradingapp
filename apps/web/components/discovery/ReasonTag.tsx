/**
 * The "why this is here" explanation — see docs/TRADER_INTELLIGENCE.md#personalization.
 * Always a plain sentence describing a real signal ("Because you follow Alex", "Active on
 * the market"), never an unexplained label like "AI picked" or "smart money".
 */
export function ReasonTag({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[0.65rem] text-accent">
      {reason}
    </span>
  );
}
