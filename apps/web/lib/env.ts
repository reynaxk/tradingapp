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
