import { describe, expect, it } from 'vitest';
import { parseEnv } from '@fomo/domain';
import { ServerEnvSchema } from './env';

describe('web server env schema', () => {
  it('defaults NODE_ENV and API_BASE_URL when unset', () => {
    expect(parseEnv(ServerEnvSchema, {})).toEqual({
      NODE_ENV: 'development',
      API_BASE_URL: 'http://localhost:4000',
    });
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => parseEnv(ServerEnvSchema, { NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a malformed API_BASE_URL rather than silently accepting it', () => {
    expect(() => parseEnv(ServerEnvSchema, { API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('accepts a real production API URL', () => {
    const result = parseEnv(ServerEnvSchema, { API_BASE_URL: 'https://api.example.com' });
    expect(result.API_BASE_URL).toBe('https://api.example.com');
  });
});
