'use client';

import { clientEnv } from './env';

/**
 * The one anonymous-session primitive every browser-side API client in this app builds on
 * — social mutations (lib/social-client.ts), wallet linking (lib/wallet-client.ts), and
 * trading (lib/trading-client.ts) all authenticate the same way, against the same session
 * JWT. See docs/SOCIAL.md#authentication. Kept separate from lib/social-client.ts so
 * neither wallet nor trading code needs to import "social" to get a session.
 */

const TOKEN_STORAGE_KEY = 'fomo:session-token';
const API_BASE = clientEnv.NEXT_PUBLIC_API_BASE_URL;

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — fall through to a fresh session
  }
}

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Nothing to persist to — the session still works for this page load, just won't
    // survive a refresh. Not worth surfacing as an error to the user.
  }
}

/** Lazily creates an anonymous session on first use — never on page load, so viewing the
 *  app never requires one (see docs/SOCIAL.md#authentication). */
export async function ensureSessionToken(): Promise<string> {
  const existing = readStoredToken();
  if (existing) return existing;

  const res = await fetch(`${API_BASE}/v1/identity/session`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not start a session');
  const body = (await res.json()) as { token: string };
  storeToken(body.token);
  return body.token;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureSessionToken();
  return fetch(`${API_BASE}/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

/** Prefers the API's own error message (AllExceptionsFilter always returns `{message}` —
 *  see apps/api/src/common/filters/all-exceptions.filter.ts) so a user sees e.g. "This
 *  challenge has expired" instead of a generic status code. */
export async function expectOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const fallback = `Failed to ${action} (${res.status})`;
  let message = fallback;
  try {
    const body = (await res.clone().json()) as { message?: string };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Body wasn't JSON (or already consumed) — fall back to the generic message above.
  }
  throw new Error(message);
}

/** True only if this browser already has a session — never creates one. */
export function hasStoredSession(): boolean {
  return readStoredToken() !== null;
}

export { API_BASE };
