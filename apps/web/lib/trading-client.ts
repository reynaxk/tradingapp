'use client';

import type { TradeQuoteDto, TradeSide, TradeTransactionDto } from '@fomo/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Browser-side calls for Phase 3 trading — see docs/TRADING.md#quote-system and
 * #transaction-lifecycle. This file only ever asks the API to *prepare* things (a quote,
 * an unsigned transaction) or to *record* something the wallet already did (a broadcast
 * tx hash) — it never signs anything and never has access to a private key. See
 * docs/WALLET_SECURITY.md.
 */

export interface GetQuoteParams {
  side: TradeSide;
  tokenAddress: string;
  walletAddress: string;
  amount: string;
  slippageBps: number;
}

export async function getQuote(params: GetQuoteParams): Promise<TradeQuoteDto> {
  const query = new URLSearchParams({
    side: params.side,
    tokenAddress: params.tokenAddress,
    walletAddress: params.walletAddress,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
  });
  const res = await authedFetch(`/trade/quote?${query.toString()}`);
  await expectOk(res, 'get a quote');
  return res.json();
}

export interface SubmitTransactionParams {
  quoteId: string;
  walletAddress: string;
  txHash: string;
}

export async function submitTransaction(params: SubmitTransactionParams): Promise<TradeTransactionDto> {
  const res = await authedFetch('/trade/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await expectOk(res, 'record the submitted transaction');
  return res.json();
}

/** Returns `null` for a 404 — either the id doesn't exist or (indistinguishably, by
 *  design) it belongs to someone else. See docs/TRADING.md#authorization. */
export async function getTransaction(id: string): Promise<TradeTransactionDto | null> {
  const res = await authedFetch(`/trade/transactions/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  await expectOk(res, 'load transaction status');
  return res.json();
}

export interface TradeHistoryPage {
  items: TradeTransactionDto[];
  nextCursor: string | null;
}

export async function getTradeHistory(params: { cursor?: string; limit?: number } = {}): Promise<TradeHistoryPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/trade/history?${query.toString()}`);
  await expectOk(res, 'load trade history');
  return res.json();
}
