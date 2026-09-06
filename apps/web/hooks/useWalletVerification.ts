'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { hasStoredSession } from '@/lib/session-client';
import { listLinkedWallets, requestWalletChallenge, verifyWalletChallenge } from '@/lib/wallet-client';

export type WalletVerificationStatus = 'disconnected' | 'checking' | 'unverified' | 'verifying' | 'verified' | 'rejected';

/**
 * Drives the SIWE-style ownership flow (see docs/TRADING.md#wallet-ownership) for whichever
 * wallet wagmi currently has connected. A connected address is never treated as proof of
 * anything — trading is gated on `status === 'verified'`, which only happens after this
 * API's own challenge has been signed and checked server-side.
 *
 * Never checks (and never mints a session to check) unless a session already exists — the
 * same "viewing never requires a session" rule Phase 2 established. A first-time visitor
 * who connects a wallet sees "Verify wallet to trade"; clicking it is the action that
 * starts a session, exactly like a first Follow click does elsewhere in this app.
 */
export function useWalletVerification() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<WalletVerificationStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setStatus('disconnected');
      return;
    }
    if (!hasStoredSession()) {
      setStatus('unverified');
      return;
    }
    setStatus('checking');
    try {
      const wallets = await listLinkedWallets();
      const linked = wallets.some((w) => w.address.toLowerCase() === address.toLowerCase());
      setStatus(linked ? 'verified' : 'unverified');
    } catch {
      setStatus('unverified');
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verify = useCallback(async () => {
    if (!address) return;
    setStatus('verifying');
    setError(null);
    try {
      const challenge = await requestWalletChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message });
      await verifyWalletChallenge(challenge.nonce, signature);
      setStatus('verified');
    } catch (err) {
      setStatus('rejected');
      setError(err instanceof Error ? err.message : 'Wallet verification failed');
    }
  }, [address, signMessageAsync]);

  return { status, error, verify, isConnected, address };
}
