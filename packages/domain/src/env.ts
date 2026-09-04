import type { z, ZodSchema } from 'zod';

/**
 * Parses `source` against `schema` and throws a readable, multi-line error listing every
 * missing or invalid variable if it fails. Every app defines its own schema (their required
 * variables genuinely differ) and calls this once at boot, so a misconfigured deploy fails
 * immediately with a clear message instead of surfacing as a confusing runtime error later.
 */
export function parseEnv<Schema extends ZodSchema>(
  schema: Schema,
  source: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
