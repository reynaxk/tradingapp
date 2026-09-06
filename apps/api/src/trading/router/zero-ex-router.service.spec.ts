import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import { ZeroExSwapRouter } from './zero-ex-router.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  return { get: () => 'test-0x-api-key' } as unknown as ConfigService<Env, true>;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const baseRequest = {
  chainId: 8453,
  sellToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buyToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sellAmountRaw: '1000000000000000000',
  taker: '0x1234567890123456789012345678901234567890',
  slippageBps: 50,
  feeRecipient: '0x1111111111111111111111111111111111111a',
  feeBps: 50,
};

const validBody = {
  buyAmount: '100000000000000000000',
  minBuyAmount: '99500000000000000000',
  liquidityAvailable: true,
  estimatedPriceImpact: '0.42',
  transaction: { to: '0xdead', data: '0xbeef', value: '0', gas: '21000', maxFeePerGas: null, maxPriorityFeePerGas: null },
  issues: { allowance: { spender: '0xspender' } },
  fees: { integratorFee: { amount: '500000000000000000' } },
};

describe('ZeroExSwapRouter', () => {
  let router: ZeroExSwapRouter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    router = new ZeroExSwapRouter(fakeConfig(), fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('parses a valid response into the internal SwapRouterQuote shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toEqual(
      expect.objectContaining({
        provider: '0x',
        buyAmountRaw: '100000000000000000000',
        minBuyAmountRaw: '99500000000000000000',
        priceImpactBps: 42,
        feeAmountRaw: '500000000000000000',
        requiresApproval: true,
        approvalSpender: '0xspender',
        unsignedTx: expect.objectContaining({ to: '0xdead', data: '0xbeef', value: '0' }),
      }),
    );
  });

  it('sends the platform fee params only when a fee recipient and non-zero bps are configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));

    await router.getQuote(baseRequest);

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('swapFeeRecipient')).toBe(baseRequest.feeRecipient);
    expect(calledUrl.searchParams.get('swapFeeBps')).toBe('50');
    expect(calledUrl.searchParams.get('swapFeeToken')).toBe(baseRequest.buyToken);
  });

  it('omits fee params entirely when feeBps is zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));

    await router.getQuote({ ...baseRequest, feeBps: 0 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.has('swapFeeRecipient')).toBe(false);
  });

  it('sends the API key and version headers, never in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));

    await router.getQuote(baseRequest);

    const options = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers['0x-api-key']).toBe('test-0x-api-key');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('test-0x-api-key');
  });

  it('returns null (never a fabricated quote) when the provider reports no liquidity', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...validBody, liquidityAvailable: false }));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the response is missing required transaction fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...validBody, transaction: { to: '0xdead' } }));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on a non-ok HTTP response rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: 'bad request' }, false, 400));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on an unparseable JSON body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) } as unknown as Response);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when estimatedPriceImpact is absent rather than fabricating a value', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...validBody, estimatedPriceImpact: null }));

    const quote = await router.getQuote(baseRequest);

    expect(quote?.priceImpactBps).toBeNull();
  });
});
