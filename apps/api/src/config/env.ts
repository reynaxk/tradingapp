import { z } from 'zod';

/**
 * Every variable the API genuinely reads at boot. Nothing here is optional-by-accident —
 * a field is only optional/defaulted when running without it is truly fine. Validated once
 * in ConfigModule.forRoot({ validate }); a misconfigured deploy fails at boot with a clear,
 * complete list of what's wrong, not a cryptic error the first time something is used.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (redis connection string)'),

  /** Comma-separated list of allowed origins, e.g. "https://fomo.app,http://localhost:3000". */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  /**
   * Signs the anonymous session issued by POST /v1/identity/session — see
   * docs/SOCIAL.md#authentication for exactly what this session does and doesn't prove.
   * A missing/weak secret fails loudly at boot, same as every other required var here.
   */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  /**
   * The numeric chain id Phase 3 trades on — must name the same chain
   * apps/workers/src/config/env.ts's CHAIN_IDENTIFIER (a CAIP-2 string, e.g. "eip155:8453")
   * already indexes; see docs/TRADING.md#chain-scope. A plain number here (rather than
   * parsing it back out of a CAIP-2 string) because every trading-provider API and every
   * wallet library expects a bare EVM chain id, not Fomo's own chain identifier format.
   */
  CHAIN_ID: z.coerce.number().int().positive(),
  /** Used only for on-chain reads Phase 3 needs directly (transaction receipt status) —
   *  never for building the swap itself, which comes fully formed from the router. */
  CHAIN_RPC_URL: z.string().url('CHAIN_RPC_URL must be a valid URL'),

  /**
   * See docs/TRADING.md#provider. Required only once real quotes are needed — validated
   * here (not left to fail at first use) so a misconfigured deploy is loud at boot, same
   * as every other required var. There is no keyless/free tier to fall back to; a missing
   * key means quotes honestly fail rather than falling back to an invented price.
   */
  ZEROEX_API_KEY: z.string().min(1, 'ZEROEX_API_KEY is required for real swap quotes'),

  /**
   * See docs/TRADING.md#fees. A bps integer, never a hardcoded literal scattered through
   * the codebase — every fee calculation reads this one value.
   */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  /** Where the platform fee lands, collected atomically by the swap transaction itself —
   *  Fomo's backend never custodies it in between. See docs/TRADING.md#fees. */
  PLATFORM_FEE_RECIPIENT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'PLATFORM_FEE_RECIPIENT_ADDRESS must be a valid EVM address'),
});

export type Env = z.infer<typeof EnvSchema>;
