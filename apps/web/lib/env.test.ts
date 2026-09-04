import { describe, expect, it } from 'vitest';
import { parseEnv } from '@fomo/domain';
import { z } from 'zod';

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

describe('web server env schema', () => {
  it('defaults NODE_ENV to development when unset', () => {
    expect(parseEnv(ServerEnvSchema, {})).toEqual({ NODE_ENV: 'development' });
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => parseEnv(ServerEnvSchema, { NODE_ENV: 'staging' })).toThrow();
  });
});
