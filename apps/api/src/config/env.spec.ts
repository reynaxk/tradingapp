import { parseEnv } from '@fomo/domain';
import { EnvSchema } from './env';

describe('API env schema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/fomo',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('accepts a minimal valid configuration and fills in defaults', () => {
    const env = parseEnv(EnvSchema, validBase);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => parseEnv(EnvSchema, { REDIS_URL: validBase.REDIS_URL })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('fails clearly when REDIS_URL is missing', () => {
    expect(() => parseEnv(EnvSchema, { DATABASE_URL: validBase.DATABASE_URL })).toThrowError(
      /REDIS_URL/,
    );
  });

  it('coerces PORT from a string env value to a number', () => {
    const env = parseEnv(EnvSchema, { ...validBase, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });
});
