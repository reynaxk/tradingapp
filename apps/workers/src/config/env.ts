import { z } from 'zod';
import { NOTIFICATION_DEFAULTS } from '@fomo/domain';

/**
 * V1 runs on exactly one chain (see /docs/CHAIN_ADAPTERS.md) — these four CHAIN_* variables
 * describe it. Adding a second chain later means adding a second set of variables and a
 * second ChainDataProvider instance, not changing this shape.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (redis connection string)'),

  CHAIN_IDENTIFIER: z.string().min(1, 'CHAIN_IDENTIFIER is required, e.g. "eip155:8453"'),
  CHAIN_NAME: z.string().min(1, 'CHAIN_NAME is required, e.g. "Base"'),
  CHAIN_NATIVE_SYMBOL: z.string().min(1, 'CHAIN_NATIVE_SYMBOL is required, e.g. "ETH"'),
  /** Resolved RPC endpoint for the configured chain — never hardcoded, never logged. */
  CHAIN_RPC_URL: z.string().url('CHAIN_RPC_URL must be a valid URL'),

  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** How often the market ingestion tick (price/liquidity refresh + swap backfill) runs. */
  MARKET_INGESTION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** How often the Phase 3 trade-status sweep checks PENDING transactions for a real
   *  on-chain receipt — see docs/TRADING.md#transaction-lifecycle. Independent of
   *  apps/api's on-demand refresh; this is the backstop for trades nobody is watching. */
  TRADE_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

  /** The one configurable knob behind "whale trade" alerts (see
   *  docs/NOTIFICATIONS.md#whale-trades) — centralized here rather than hardcoded at each
   *  call site, and defaulted from the same @fomo/domain constant apps/api would use if it
   *  ever needed to display this threshold, so the two processes can never disagree. */
  WHALE_TRADE_USD_THRESHOLD: z.coerce.number().positive().default(NOTIFICATION_DEFAULTS.whaleTradeUsdThreshold),
});

export type Env = z.infer<typeof EnvSchema>;
