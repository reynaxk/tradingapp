import { describe, expect, it } from 'vitest';
import { ChainSchema, CreateChainInputSchema } from './chain';
import { TokenSchema } from './token';
import { TokenMarketSchema } from './token-market';

describe('ChainSchema', () => {
  it('accepts a well-formed chain', () => {
    const result = ChainSchema.safeParse({
      id: 1,
      identifier: 'eip155:8453',
      name: 'Base',
      nativeSymbol: 'ETH',
      rpcConfigKey: 'BASE_MAINNET_RPC',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a chain with no identifier', () => {
    const result = CreateChainInputSchema.safeParse({
      identifier: '',
      name: 'Base',
      nativeSymbol: 'ETH',
      rpcConfigKey: 'BASE_MAINNET_RPC',
    });
    expect(result.success).toBe(false);
  });
});

describe('TokenSchema', () => {
  it('allows chain-derived fields to be null rather than fabricated', () => {
    const result = TokenSchema.safeParse({
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      chainId: 1,
      contractAddress: '0x1234567890123456789012345678901234567890',
      symbol: null,
      name: null,
      decimals: null,
      logoUrl: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});

describe('TokenMarketSchema', () => {
  it('requires a pair address and both sides of the market', () => {
    const result = TokenMarketSchema.safeParse({
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      chainId: 1,
      tokenId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      quoteTokenId: '9c858901-8a57-4791-81fe-4c455b099bc9',
      dex: null,
      pairAddress: '0xabc',
      liquidityUsd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});
