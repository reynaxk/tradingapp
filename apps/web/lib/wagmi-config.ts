import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { clientEnv } from './env';

/**
 * Phase 3 — see docs/TRADING.md#chain-scope. Exactly one chain, matching apps/api's
 * CHAIN_ID (Base). `injected()` covers every desktop browser-extension wallet (MetaMask,
 * Rabby, and Coinbase Wallet's own extension all inject the same EIP-1193 interface) and
 * any mobile wallet's in-app browser. WalletConnect (true QR-code mobile pairing, including
 * Coinbase Wallet mobile) is additive and optional — simply omitted, never broken, when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't configured. `wagmi/connectors`' own
 * `coinbaseWallet()` connector is deliberately not used here: as of the versions this
 * monorepo pins, it pulls in `@coinbase/cdp-sdk`'s optional x402-payments code path, which
 * references packages (`@x402/evm`) that aren't installed and that Next's webpack build
 * fails trying to resolve statically — a real upstream packaging issue, not something this
 * app can silence via config, and not worth the dependency weight for a feature (in-wallet
 * payments) this app doesn't use. See docs/TRADING.md#wallet-connectivity.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(),
    ...(clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID })]
      : []),
  ],
  transports: {
    [base.id]: http(clientEnv.NEXT_PUBLIC_CHAIN_RPC_URL),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
