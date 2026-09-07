import { describe, expect, it } from 'vitest';
import { EvmChainDataProvider } from './evm-adapter';

describe('EvmChainDataProvider', () => {
  const chain = { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' };

  it('exposes the chain descriptor it was configured with', () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    expect(provider.chain).toEqual(chain);
  });

  it('reports unhealthy rather than throwing when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(provider.isHealthy()).resolves.toBe(false);
  });

  it('returns nulls instead of fabricating token metadata when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(
      provider.getTokenMetadata('0x1234567890123456789012345678901234567890'),
    ).resolves.toEqual({ symbol: null, name: null, decimals: null });
  });

  it('returns null instead of fabricating transaction details when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(provider.getTransactionDetails(`0x${'1'.repeat(64)}`)).resolves.toBeNull();
  });
});
