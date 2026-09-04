import { parseEnv } from '@fomo/domain';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/fomo',
  REDIS_URL: 'redis://localhost:6379',
  CHAIN_IDENTIFIER: 'eip155:8453',
  CHAIN_NAME: 'Base',
  CHAIN_NATIVE_SYMBOL: 'ETH',
  CHAIN_RPC_URL: 'https://base-mainnet.example.com/rpc',
};

describe('workers env schema', () => {
  it('accepts a complete, valid configuration', () => {
    expect(() => parseEnv(EnvSchema, valid)).not.toThrow();
  });

  it('fails clearly when the chain RPC URL is missing', () => {
    const { CHAIN_RPC_URL: _drop, ...rest } = valid;
    expect(() => parseEnv(EnvSchema, rest)).toThrowError(/CHAIN_RPC_URL/);
  });

  it('rejects a malformed RPC URL rather than silently accepting it', () => {
    expect(() => parseEnv(EnvSchema, { ...valid, CHAIN_RPC_URL: 'not-a-url' })).toThrow();
  });
});
