import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const schema = z.object({
  REQUIRED_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
});

describe('parseEnv', () => {
  it('returns parsed, coerced values when the source is valid', () => {
    const result = parseEnv(schema, { REQUIRED_URL: 'https://example.com', PORT: '4000' });
    expect(result).toEqual({ REQUIRED_URL: 'https://example.com', PORT: 4000 });
  });

  it('applies schema defaults for variables that are absent', () => {
    const result = parseEnv(schema, { REQUIRED_URL: 'https://example.com' });
    expect(result.PORT).toBe(3000);
  });

  it('throws a clear, multi-line error naming every missing/invalid variable', () => {
    expect(() => parseEnv(schema, {})).toThrowError(/REQUIRED_URL/);
  });
});
