import type { UnsignedTransaction } from '@fomo/domain';

/**
 * Every provider-specific detail (0x's exact endpoints, headers, response shape) lives
 * behind this interface — see docs/TRADING.md#provider. Swapping providers later means
 * writing a new class implementing this, never touching QuoteService or anything above it.
 */
export interface SwapRouterQuoteRequest {
  chainId: number;
  sellToken: string;
  buyToken: string;
  /** Raw integer units of `sellToken`, as a string — see docs/TRADING.md#financial-precision. */
  sellAmountRaw: string;
  /** The wallet that will execute the trade — routers use this to size an accurate gas
   *  estimate and to report whether an ERC20 approval is still needed. */
  taker: string;
  slippageBps: number;
  /** Where the platform fee is sent, if this call should request fee collection — see
   *  docs/TRADING.md#fees. `null` when fee collection isn't configured. */
  feeRecipient: string | null;
  feeBps: number;
}

export interface SwapRouterQuote {
  provider: string;
  providerQuoteId: string | null;
  /** Raw integer units, as strings — never a JS `number`. */
  buyAmountRaw: string;
  sellAmountRaw: string;
  minBuyAmountRaw: string;
  /** Percent price impact in basis points, when the provider's response supports
   *  computing it — `null`, never invented, otherwise. See docs/TRADING.md#price-impact. */
  priceImpactBps: number | null;
  /** The platform fee the provider's own quote already accounts for (deducted from the
   *  output as part of the same transaction) — `null` if fee collection wasn't requested
   *  or the provider didn't confirm one. */
  feeAmountRaw: string | null;
  /** `true` when the taker must submit an ERC20 `approve()` before the swap transaction
   *  can succeed — see docs/TRADING.md#transaction-construction. */
  requiresApproval: boolean;
  approvalSpender: string | null;
  unsignedTx: UnsignedTransaction;
}

export interface SwapRouter {
  /** Returns `null` — never a fabricated quote — when the provider can't price this pair
   *  right now (no route, provider outage, unsupported token). See
   *  docs/TRADING.md#quote-system. */
  getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null>;
}
