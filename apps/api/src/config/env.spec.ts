import { parseEnv } from '@fomo/domain';
import { EnvSchema } from './env';

describe('API env schema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/fomo',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a-test-secret-at-least-16-chars',
    CHAIN_ID: '8453',
    CHAIN_RPC_URL: 'https://mainnet.base.org',
    ZEROEX_API_KEY: 'test-key',
    PLATFORM_FEE_RECIPIENT_ADDRESS: '0x1234567890123456789012345678901234567890',
  };

  it('accepts a minimal valid configuration and fills in defaults', () => {
    const env = parseEnv(EnvSchema, validBase);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.PLATFORM_FEE_BPS).toBe(50);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'DATABASE_URL'))).toThrowError(/DATABASE_URL/);
  });

  it('fails clearly when REDIS_URL is missing', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'REDIS_URL'))).toThrowError(/REDIS_URL/);
  });

  it('fails clearly when JWT_SECRET is missing', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'JWT_SECRET'))).toThrowError(/JWT_SECRET/);
  });

  it('fails clearly when JWT_SECRET is too short', () => {
    expect(() => parseEnv(EnvSchema, { ...validBase, JWT_SECRET: 'short' })).toThrowError(/JWT_SECRET/);
  });

  it('coerces PORT from a string env value to a number', () => {
    const env = parseEnv(EnvSchema, { ...validBase, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('fails clearly when CHAIN_ID is missing', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'CHAIN_ID'))).toThrowError(/CHAIN_ID/);
  });

  it('coerces CHAIN_ID from a string env value to a number', () => {
    expect(parseEnv(EnvSchema, validBase).CHAIN_ID).toBe(8453);
  });

  it('fails clearly when CHAIN_RPC_URL is missing or malformed', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'CHAIN_RPC_URL'))).toThrowError(/CHAIN_RPC_URL/);
    expect(() => parseEnv(EnvSchema, { ...validBase, CHAIN_RPC_URL: 'not-a-url' })).toThrowError(/CHAIN_RPC_URL/);
  });

  it('fails clearly when ZEROEX_API_KEY is missing', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'ZEROEX_API_KEY'))).toThrowError(/ZEROEX_API_KEY/);
  });

  it('fails clearly when PLATFORM_FEE_RECIPIENT_ADDRESS is missing or malformed', () => {
    expect(() => parseEnv(EnvSchema, omit(validBase, 'PLATFORM_FEE_RECIPIENT_ADDRESS'))).toThrowError(
      /PLATFORM_FEE_RECIPIENT_ADDRESS/,
    );
    expect(() =>
      parseEnv(EnvSchema, { ...validBase, PLATFORM_FEE_RECIPIENT_ADDRESS: 'not-an-address' }),
    ).toThrowError(/PLATFORM_FEE_RECIPIENT_ADDRESS/);
  });

  it('defaults PLATFORM_FEE_BPS to 50 (0.50%) and accepts an override within range', () => {
    expect(parseEnv(EnvSchema, validBase).PLATFORM_FEE_BPS).toBe(50);
    expect(parseEnv(EnvSchema, { ...validBase, PLATFORM_FEE_BPS: '75' }).PLATFORM_FEE_BPS).toBe(75);
  });

  it('rejects a PLATFORM_FEE_BPS outside the sane configured range', () => {
    expect(() => parseEnv(EnvSchema, { ...validBase, PLATFORM_FEE_BPS: '-1' })).toThrow();
    expect(() => parseEnv(EnvSchema, { ...validBase, PLATFORM_FEE_BPS: '10000' })).toThrow();
  });
});

function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}
