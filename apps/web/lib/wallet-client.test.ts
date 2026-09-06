import { afterEach, describe, expect, it, vi } from 'vitest';
import { listLinkedWallets, requestWalletChallenge, unlinkWallet, verifyWalletChallenge } from './wallet-client';

const { authedFetch, expectOk } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  expectOk: vi.fn(),
}));

vi.mock('./session-client', () => ({ authedFetch, expectOk }));

function fakeResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => vi.clearAllMocks());

describe('wallet-client', () => {
  it('requests a challenge for the given address', async () => {
    authedFetch.mockResolvedValue(fakeResponse({ nonce: 'n1', message: 'msg', expiresAt: '2026-01-01T00:00:00.000Z' }));

    await requestWalletChallenge('0xabc');

    expect(authedFetch).toHaveBeenCalledWith(
      '/identity/wallet/challenge',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ address: '0xabc' }) }),
    );
    expect(expectOk).toHaveBeenCalledWith(expect.anything(), 'start wallet verification');
  });

  it('verifies a challenge with the nonce and signature', async () => {
    authedFetch.mockResolvedValue(fakeResponse({ address: '0xabc', verifiedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }));

    await verifyWalletChallenge('nonce-1', '0xsig');

    expect(authedFetch).toHaveBeenCalledWith(
      '/identity/wallet/verify',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ nonce: 'nonce-1', signature: '0xsig' }) }),
    );
  });

  it('lists linked wallets', async () => {
    authedFetch.mockResolvedValue(fakeResponse([]));
    await listLinkedWallets();
    expect(authedFetch).toHaveBeenCalledWith('/identity/wallets');
  });

  it('unlinks a wallet by address, URL-encoded', async () => {
    authedFetch.mockResolvedValue(fakeResponse(undefined));
    await unlinkWallet('0xAbC');
    expect(authedFetch).toHaveBeenCalledWith('/identity/wallets/0xAbC', { method: 'DELETE' });
  });

  it('propagates the API error message rather than swallowing it', async () => {
    authedFetch.mockResolvedValue(fakeResponse({}));
    expectOk.mockRejectedValue(new Error('Signature verification failed'));

    await expect(verifyWalletChallenge('n', 's')).rejects.toThrow('Signature verification failed');
  });
});
