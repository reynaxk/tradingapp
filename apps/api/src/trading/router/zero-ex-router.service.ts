import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const ZERO_EX_BASE_URL = 'https://api.0x.org';

/**
 * 0x's Swap API (Allowance-Holder quote endpoint) — see docs/TRADING.md#provider for why
 * this provider and exactly which endpoint. All 0x-specific request/response shape lives
 * here; nothing outside this file knows 0x exists. Written against 0x's long-standing
 * `/swap/allowance-holder/quote` contract; re-verify field names against 0x's current docs
 * before depending on this in production — see the docs/TRADING.md note on why this
 * couldn't be confirmed against a live key in this environment.
 */
@Injectable()
export class ZeroExSwapRouter implements SwapRouter {
  private readonly apiKey: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.apiKey = config.get('ZEROEX_API_KEY', { infer: true });
    this.logger.setContext('ZeroExSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const params = new URLSearchParams({
      chainId: String(request.chainId),
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      sellAmount: request.sellAmountRaw,
      taker: request.taker,
      slippageBps: String(request.slippageBps),
    });
    if (request.feeRecipient && request.feeBps > 0) {
      params.set('swapFeeRecipient', request.feeRecipient);
      params.set('swapFeeBps', String(request.feeBps));
      // Fee taken from what the trader receives — see docs/TRADING.md#fees.
      params.set('swapFeeToken', request.buyToken);
    }

    const url = `${ZERO_EX_BASE_URL}/swap/allowance-holder/quote?${params.toString()}`;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { '0x-api-key': this.apiKey, '0x-version': 'v2' },
      });
    } catch (error) {
      this.logger.warn({ err: error, latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable');
      return null;
    }

    if (!response.ok) {
      // Never leak the raw provider body (may echo request params back) — log status only.
      this.logger.warn(
        { status: response.status, latencyMs: Date.now() - startedAt },
        'quote failure: provider rejected the request',
      );
      return null;
    }

    let body: ZeroExQuoteResponse;
    try {
      body = (await response.json()) as ZeroExQuoteResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'quote failure: provider returned an unparseable response');
      return null;
    }

    const parsed = parseZeroExQuote(body);
    if (!parsed) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider response missing required fields');
      return null;
    }

    this.logger.info({ latencyMs: Date.now() - startedAt }, 'quote created');
    return parsed;
  }
}

/** The slice of 0x's response this adapter actually reads — deliberately not a full,
 *  strict type of 0x's entire schema, since unrecognized extra fields are expected and
 *  harmless (0x can add fields without this adapter needing an update). */
interface ZeroExQuoteResponse {
  buyAmount?: string;
  minBuyAmount?: string;
  liquidityAvailable?: boolean;
  estimatedPriceImpact?: string | null;
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
    gas?: string | null;
    gasPrice?: string | null;
    maxFeePerGas?: string | null;
    maxPriorityFeePerGas?: string | null;
  };
  issues?: {
    allowance?: { spender?: string } | null;
  };
  fees?: {
    integratorFee?: { amount?: string } | null;
  };
}

function parseZeroExQuote(body: ZeroExQuoteResponse): SwapRouterQuote | null {
  if (body.liquidityAvailable === false) return null; // honest "no route," never a fabricated price
  const tx = body.transaction;
  if (!body.buyAmount || !body.minBuyAmount || !tx?.to || !tx.data || tx.value === undefined) return null;

  const priceImpactBps = parsePriceImpactBps(body.estimatedPriceImpact);
  const approvalSpender = body.issues?.allowance?.spender ?? null;

  return {
    provider: '0x',
    providerQuoteId: null, // 0x's allowance-holder quote doesn't issue its own quote id
    buyAmountRaw: body.buyAmount,
    sellAmountRaw: '', // filled in by QuoteService from the request it already knows
    minBuyAmountRaw: body.minBuyAmount,
    priceImpactBps,
    feeAmountRaw: body.fees?.integratorFee?.amount ?? null,
    requiresApproval: approvalSpender !== null,
    approvalSpender,
    unsignedTx: {
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: tx.gas ?? null,
      maxFeePerGas: tx.maxFeePerGas ?? null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
    },
  };
}

/** `estimatedPriceImpact` is a decimal percentage string (e.g. "0.5" for 0.5%) — a small
 *  display figure, not a token amount, so `parseFloat` here doesn't violate
 *  docs/TRADING.md#financial-precision (that rule is about exact token/fee math). */
function parsePriceImpactBps(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const percent = Number.parseFloat(raw);
  if (!Number.isFinite(percent)) return null;
  return Math.round(percent * 100);
}
