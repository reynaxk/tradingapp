'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@fomo/ui';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { base } from 'wagmi/chains';
import { truncateAddress } from '@/lib/format';

/**
 * Phase 3 — see docs/TRADING.md#wallet-connectivity. Exposes exactly what the trading flow
 * needs to reason about: address, chain id, connection status, disconnect, and — critically
 * — a "Wrong network" state that blocks trading rather than silently executing on whatever
 * chain the wallet happens to be on. Connecting a wallet here is *not* the same as owning
 * it: nothing here proves anything to the API on its own — see hooks/useWalletVerification.ts
 * and components/trading/TradePanel.tsx, which gate trading on a signature-verified wallet.
 */
export function ConnectWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  if (!isConnected) {
    return (
      <div ref={containerRef} className="relative">
        <Button type="button" variant="primary" onClick={() => setMenuOpen((open) => !open)}>
          Connect Wallet
        </Button>
        {menuOpen && (
          <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                disabled={isConnecting}
                onClick={() => {
                  connect({ connector });
                  setMenuOpen(false);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left font-body text-sm text-ink-900 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connector.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (chainId !== base.id) {
    return (
      <Button type="button" variant="secondary" className="border border-down/40 text-down" onClick={() => switchChain({ chainId: base.id })} disabled={isSwitching}>
        {isSwitching ? 'Switching…' : 'Wrong network — Switch to Base'}
      </Button>
    );
  }

  return (
    <Button type="button" variant="secondary" onClick={() => disconnect()} title="Disconnect wallet">
      {truncateAddress(address as string)}
    </Button>
  );
}
