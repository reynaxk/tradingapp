import { parseEnv } from '@fomo/domain';
import { z } from 'zod';

/**
 * Nothing in Phase 0 is genuinely required yet — the shell doesn't call the API. Add fields
 * here as later phases introduce real dependencies (e.g. NEXT_PUBLIC_API_URL once the app
 * starts fetching); the app will then fail fast at boot with a clear message if one is
 * missing, instead of failing confusingly at the point of use.
 */
const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export const env: ServerEnv = parseEnv(ServerEnvSchema, process.env);
