import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQuote, getTradeHistory, getTransaction, submitTransaction } from './trading-client';

const { authedFetch, expectOk } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  expectOk: vi.fn(),
}));

vi.mock('./session-client', () => ({ authedFetch, expectOk }));

function fakeResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => vi.clearAllMocks());

describe('trading-client', () => {
  it('builds the quote query string from every param, never guessing a default server-side', async () => {
    authedFetch.mockResolvedValue(fakeResponse({}));

    await getQuote({ side: 'BUY', tokenAddress: '0xtoken', walletAddress: '0xwallet', amount: '1.5', slippageBps: 75 });

    const [path] = authedFetch.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('side')).toBe('BUY');
    expect(query.get('tokenAddress')).toBe('0xtoken');
    expect(query.get('walletAddress')).toBe('0xwallet');
    expect(query.get('amount')).toBe('1.5');
    expect(query.get('slippageBps')).toBe('75');
  });

  it('submits a transaction as JSON', async () => {
    authedFetch.mockResolvedValue(fakeResponse({}));

    await submitTransaction({ quoteId: 'q1', walletAddress: '0xwallet', txHash: '0xhash' });

    expect(authedFetch).toHaveBeenCalledWith(
      '/trade/transactions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ quoteId: 'q1', walletAddress: '0xwallet', txHash: '0xhash' }),
      }),
    );
  });

  it('returns null for a 404 transaction lookup instead of throwing', async () => {
    authedFetch.mockResolvedValue(fakeResponse({}, 404));

    const result = await getTransaction('missing-id');

    expect(result).toBeNull();
    expect(expectOk).not.toHaveBeenCalled();
  });

  it('returns the transaction for a successful lookup', async () => {
    authedFetch.mockResolvedValue(fakeResponse({ id: 'tx-1', status: 'PENDING' }));

    const result = await getTransaction('tx-1');

    expect(result).toEqual({ id: 'tx-1', status: 'PENDING' });
  });

  it('paginates history with cursor and limit', async () => {
    authedFetch.mockResolvedValue(fakeResponse({ items: [], nextCursor: null }));

    await getTradeHistory({ cursor: 'abc', limit: 10 });

    const [path] = authedFetch.mock.calls[0] as [string];
    expect(path).toContain('cursor=abc');
    expect(path).toContain('limit=10');
  });
});
