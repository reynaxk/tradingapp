import type { TradeQuoteDto } from '@fomo/domain';
import { cn } from '@fomo/ui';

/**
 * Every figure here comes straight from the quote the API returned — see
 * docs/TRADING.md#fees and #price-impact. Nothing is recomputed or estimated client-side;
 * what's shown here is exactly what the wallet will be asked to sign.
 */
export function QuoteSummary({ quote }: { quote: TradeQuoteDto }) {
  const impactColor =
    quote.priceImpactLevel === 'extreme' ? 'text-down' : quote.priceImpactLevel === 'high' ? 'text-down' : 'text-ink-900';

  return (
    <dl className="space-y-2 rounded-xl bg-surface-raised p-3 font-body text-sm">
      <Row label="You pay" value={`${quote.inputAmountFormatted} ${quote.side === 'BUY' ? quote.quoteToken.symbol : quote.token.symbol}`} />
      <Row label="You receive" value={`${quote.expectedOutputAmountFormatted} ${quote.side === 'BUY' ? quote.token.symbol : quote.quoteToken.symbol}`} />
      <Row label="Minimum received" value={`${quote.minOutputAmountFormatted} ${quote.side === 'BUY' ? quote.token.symbol : quote.quoteToken.symbol}`} />
      <Row
        label="Price impact"
        value={quote.priceImpactBps === null ? '—' : `${(quote.priceImpactBps / 100).toFixed(2)}%`}
        valueClassName={impactColor}
      />
      <Row label="Slippage tolerance" value={`${(quote.slippageBps / 100).toFixed(quote.slippageBps % 100 === 0 ? 0 : 1)}%`} />
      <Row label={`Fomo fee (${(quote.platformFeeBps / 100).toFixed(2)}%)`} value={`${quote.platformFeeAmountFormatted} ${quote.token.symbol}`} />
      <Row label="Provider" value={quote.provider} />
      {quote.requiresApproval && <Row label="Token approval" value="Required before this trade" />}

      {quote.priceImpactLevel === 'extreme' && (
        <p className="!mt-3 rounded-lg bg-down/10 px-2.5 py-2 text-xs text-down">
          ⚠ Extreme price impact — this trade may move the market by {((quote.priceImpactBps ?? 0) / 100).toFixed(1)}%. Consider a smaller amount.
        </p>
      )}
      {quote.priceImpactLevel === 'high' && (
        <p className="!mt-3 rounded-lg bg-down/10 px-2.5 py-2 text-xs text-down">
          ⚠ High price impact — this trade may move the market by {((quote.priceImpactBps ?? 0) / 100).toFixed(1)}%.
        </p>
      )}
      <p className="!mt-3 font-body text-xs text-ink-400">{quote.safetyNote}</p>
    </dl>
  );
}

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-600">{label}</dt>
      <dd className={cn('font-mono text-ink-900', valueClassName)}>{value}</dd>
    </div>
  );
}
