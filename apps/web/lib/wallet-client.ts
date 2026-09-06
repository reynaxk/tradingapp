'use client';

import type { LinkedWallet, WalletChallenge } from '@fomo/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Browser-side calls for Phase 3 wallet ownership — see docs/TRADING.md#wallet-ownership.
 * A connected wallet (wagmi) is only ever a *claimed* address until it signs a challenge
 * this API issued; nothing here treats "wagmi says this address is connected" as proof of
 * anything on its own.
 */

export async function requestWalletChallenge(address: string): Promise<WalletChallenge> {
  const res = await authedFetch('/identity/wallet/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  await expectOk(res, 'start wallet verification');
  return res.json();
}

export async function verifyWalletChallenge(nonce: string, signature: string): Promise<LinkedWallet> {
  const res = await authedFetch('/identity/wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, signature }),
  });
  await expectOk(res, 'verify wallet ownership');
  return res.json();
}

export async function listLinkedWallets(): Promise<LinkedWallet[]> {
  const res = await authedFetch('/identity/wallets');
  await expectOk(res, 'load linked wallets');
  return res.json();
}

export async function unlinkWallet(address: string): Promise<void> {
  const res = await authedFetch(`/identity/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' });
  await expectOk(res, 'unlink wallet');
}
