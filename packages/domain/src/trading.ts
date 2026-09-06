import { z } from 'zod';

/**
 * Phase 3 trading domain: quotes, fees, slippage, and the transaction lifecycle. See
 * docs/TRADING.md. Every token amount here is a raw (pre-decimals) integer — a `bigint` in
 * code, a `string` at rest and over the wire — never a JS `number`. `number` only ever
 * appears for USD/percentage display values, which are inherently approximate and never
 * fed back into a calculation that must be exact.
 */

export const TradeSideSchema = z.enum(['BUY', 'SELL']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

export const TradeStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED']);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

/**
 * Deliberately configuration, not scattered literals — see docs/TRADING.md#fees. Every one
 * of these can be overridden by the API's env config; these are only the shipped defaults.
 */
export const TRADING_DEFAULTS = {
  /** 0.50% — see docs/TRADING.md#fees. */
  platformFeeBps: 50,
  /** No fixed-dollar minimum fee: on a small trade a flat minimum is an arbitrarily large
   *  effective rate (see docs/TRADING.md#small-trade-fee-rule) — disabled unless a future
   *  minimum is explicitly configured. */
  platformFeeMinUsd: null as number | null,
  defaultSlippageBps: 50,
  minSlippageBps: 1,
  /** 20% — above this a slippage tolerance stops being a safety margin and starts being an
   *  invitation to sandwich the trade; reject it rather than trust it. */
  maxSlippageBps: 2000,
  quoteTtlSeconds: 30,
  /** How long a submitted transaction can sit with no receipt before Phase 3 gives up
   *  watching it and marks it EXPIRED (likely dropped/replaced in the mempool) rather than
   *  polling forever — see docs/TRADING.md#transaction-lifecycle. Base's block time is
   *  ~2s, so 30 minutes is generous, not tight. */
  pendingTransactionTimeoutMinutes: 30,
  /** Price impact at/above this warrants a visible warning but not blocking the trade. */
  highPriceImpactBps: 500,
  /** Price impact at/above this requires the explicit acknowledgement described in
   *  docs/TRADING.md#price-impact before the UI allows signing. */
  extremePriceImpactBps: 1500,
} as const;

/** The exact, honest wording for every trade surface — see docs/TRADING.md#token-safety.
 *  Never "Safe" or "Verified": Fomo's checks are real but bounded (liquidity, staleness,
 *  that a route exists), not a security audit. */
export const SAFETY_DISCLAIMER = 'No known issues detected by available checks.';

export type PriceImpactLevel = 'normal' | 'high' | 'extreme';

export function classifyPriceImpactBps(bps: number | null): PriceImpactLevel | null {
  if (bps === null) return null;
  if (bps >= TRADING_DEFAULTS.extremePriceImpactBps) return 'extreme';
  if (bps >= TRADING_DEFAULTS.highPriceImpactBps) return 'high';
  return 'normal';
}

/** Integer basis points only, within the configured safe range — see
 *  docs/TRADING.md#slippage. Rejects, rather than clamps, an out-of-range value: silently
 *  substituting a "safe" number for a dangerous client input would hide the mistake instead
 *  of surfacing it. */
export function isValidSlippageBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= TRADING_DEFAULTS.minSlippageBps && bps <= TRADING_DEFAULTS.maxSlippageBps;
}

/**
 * Exact integer basis-points math on raw token units — never floating point (see
 * docs/TRADING.md#financial-precision). `feeBps` is a parameter, not a hardcoded import, so
 * every caller must state which fee it's applying rather than assuming a global default.
 */
export function calculateFeeAmount(amountRaw: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0) throw new Error('feeBps must be a non-negative integer');
  if (amountRaw < 0n) throw new Error('amountRaw must not be negative');
  return (amountRaw * BigInt(feeBps)) / 10_000n;
}

/** The floor output amount a transaction must enforce on-chain to honor a given slippage
 *  tolerance — what "slippage protection" concretely means in this codebase. */
export function calculateMinOutputAmount(expectedOutputRaw: bigint, slippageBps: number): bigint {
  if (!isValidSlippageBps(slippageBps)) throw new Error('slippageBps out of the allowed range');
  if (expectedOutputRaw < 0n) throw new Error('expectedOutputRaw must not be negative');
  return (expectedOutputRaw * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function isQuoteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export const UnsignedTransactionSchema = z.object({
  to: z.string(),
  data: z.string(),
  /** Raw wei, as a string — see the module comment above. */
  value: z.string(),
  gas: z.string().nullable(),
  maxFeePerGas: z.string().nullable(),
  maxPriorityFeePerGas: z.string().nullable(),
});
export type UnsignedTransaction = z.infer<typeof UnsignedTransactionSchema>;

const TradeTokenSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable(),
  decimals: z.number().int(),
});

/**
 * A priced, signable offer — the API's `GET /trade/quote` response shape. `*Formatted`
 * fields are decimal strings for display only (via `viem`'s `formatUnits`), derived from
 * the raw fields and never fed back into a calculation — see
 * docs/TRADING.md#financial-precision.
 */
export const TradeQuoteSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  side: TradeSideSchema,
  token: TradeTokenSchema,
  quoteToken: TradeTokenSchema,
  inputAmount: z.string(),
  expectedOutputAmount: z.string(),
  minOutputAmount: z.string(),
  inputAmountFormatted: z.string(),
  expectedOutputAmountFormatted: z.string(),
  minOutputAmountFormatted: z.string(),
  priceUsd: z.number().nullable(),
  priceImpactBps: z.number().int().nullable(),
  priceImpactLevel: z.enum(['normal', 'high', 'extreme']).nullable(),
  slippageBps: z.number().int(),
  platformFeeBps: z.number().int(),
  platformFeeAmount: z.string(),
  platformFeeAmountFormatted: z.string(),
  provider: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  unsignedTx: UnsignedTransactionSchema,
  /** See SAFETY_DISCLAIMER above — a fixed, honest disclosure string, never a "Safe" badge. */
  safetyNote: z.string(),
  requiresApproval: z.boolean(),
  approvalSpender: z.string().nullable(),
});
export type TradeQuoteDto = z.infer<typeof TradeQuoteSchema>;

/** The `GET /trade/history` / `GET /trade/transactions/:id` response shape. Status comes
 *  from an on-chain receipt check, never a client claim — see
 *  docs/TRADING.md#transaction-lifecycle. */
export const TradeTransactionSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  txHash: z.string(),
  side: TradeSideSchema,
  token: TradeTokenSchema,
  quoteToken: TradeTokenSchema,
  inputAmount: z.string(),
  expectedOutputAmount: z.string(),
  inputAmountFormatted: z.string(),
  expectedOutputAmountFormatted: z.string(),
  platformFeeAmount: z.string(),
  platformFeeAmountFormatted: z.string(),
  status: TradeStatusSchema,
  failureReason: z.string().nullable(),
  submittedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TradeTransactionDto = z.infer<typeof TradeTransactionSchema>;
