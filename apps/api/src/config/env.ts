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
});

export type Env = z.infer<typeof EnvSchema>;
