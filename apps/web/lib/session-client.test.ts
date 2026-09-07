import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedFetch, ensureSessionToken, expectOk, hasStoredSession } from './session-client';

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return this;
    },
  } as unknown as Response;
}

describe('session-client', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('expectOk', () => {
    it('resolves without throwing for an ok response', async () => {
      await expect(expectOk(jsonResponse({}, 200), 'do a thing')).resolves.toBeUndefined();
    });

    it('prefers the API-provided message over a generic fallback', async () => {
      await expect(expectOk(jsonResponse({ message: 'This challenge has expired' }, 400), 'verify wallet')).rejects.toThrow(
        'This challenge has expired',
      );
    });

    it('falls back to a generic message when the body has no message field', async () => {
      await expect(expectOk(jsonResponse({}, 500), 'do a thing')).rejects.toThrow('Failed to do a thing (500)');
    });

    it('falls back to a generic message when the body is not JSON', async () => {
      const res = { ok: false, status: 502, clone() { return this; }, json: () => Promise.reject(new Error('not json')) } as unknown as Response;
      await expect(expectOk(res, 'do a thing')).rejects.toThrow('Failed to do a thing (502)');
    });
  });

  describe('hasStoredSession / ensureSessionToken', () => {
    it('reports no session when localStorage is empty', () => {
      expect(hasStoredSession()).toBe(false);
    });

    it('mints a session lazily and persists it', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ token: 'jwt-123', userId: 'user-1' }, 201)),
      );

      const token = await ensureSessionToken();

      expect(token).toBe('jwt-123');
      expect(hasStoredSession()).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('reuses an existing session instead of minting a new one', async () => {
      window.localStorage.setItem('fomo:session-token', 'existing-token');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const token = await ensureSessionToken();

      expect(token).toBe('existing-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('authedFetch', () => {
    it('attaches a bearer token to every request', async () => {
      window.localStorage.setItem('fomo:session-token', 'my-token');
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
      vi.stubGlobal('fetch', fetchMock);

      await authedFetch('/trade/history');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
    });
  });
});
