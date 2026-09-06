import { parseEnv } from '@fomo/domain';
import { z } from 'zod';

/**
 * Server-only — every market-data fetch happens in Server Components/Route Handlers, so
 * the browser never needs (and is never given) the API's address directly. That's also
 * why this is `API_BASE_URL`, not `NEXT_PUBLIC_API_URL`: nothing here should ever be
 * inlined into the client bundle. See docs/MARKET_DATA.md.
 */
export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export const env: ServerEnv = parseEnv(ServerEnvSchema, process.env);

/**
 * The one deliberate exception to "the browser never talks to the API directly" — see
 * docs/SOCIAL.md#realtime. A live SSE connection and a follow/like mutation both need a
 * real browser-to-API request, which structurally cannot go through a Server Component.
 * `NEXT_PUBLIC_`-prefixed vars are inlined into the client bundle by Next.js at build
 * time; nothing secret may ever be added to this schema.
 */
export const ClientEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** Phase 3 — see docs/TRADING.md#chain-scope. The one chain the wallet-connect UI will
   *  ever offer to trade on; must name the same chain apps/api's CHAIN_ID does. Public by
   *  nature (every wallet already knows every chain id), so NEXT_PUBLIC_ is correct here
   *  unlike API_BASE_URL above. */
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  /** A public RPC endpoint the *browser* reads from directly (e.g. to detect the wallet's
   *  current network) — never the same trust boundary as apps/api's own CHAIN_RPC_URL, and
   *  fine to expose since it's read-only and rate-limited server-side regardless. */
  NEXT_PUBLIC_CHAIN_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  /** Optional: enables WalletConnect (mobile wallets that aren't an in-app browser) in
   *  addition to injected/Coinbase Wallet connectors. Get one at https://cloud.reown.com —
   *  wallet connect is simply omitted, not broken, when this isn't set. */
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;

export const clientEnv: ClientEnv = parseEnv(ClientEnvSchema, {
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_CHAIN_RPC_URL: process.env.NEXT_PUBLIC_CHAIN_RPC_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});
