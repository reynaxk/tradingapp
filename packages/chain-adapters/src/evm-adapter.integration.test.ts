import { describe, expect, it } from 'vitest';
import { EvmChainDataProvider } from './evm-adapter';
import { UniswapV3PoolReader } from './uniswap-v3';

/**
 * Runs against the real Base mainnet public RPC — deliberately not mocked, same rationale
 * as uniswap-v3.integration.test.ts. `getTransactionDetails` is the read Phase 3's
 * transaction-integrity check (docs/TRADING.md#transaction-integrity) depends on to prove a
 * submitted hash's real sender/destination/value/calldata match what was quoted; this is
 * the one place proving that decode actually works against a real, live transaction rather
 * than a fixture. Needs outbound network access.
 */
const RPC_URL = 'https://mainnet.base.org';
const CHAIN = { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' };
const WETH_USDC_POOL = '0x6c561B446416E1A00E8E93E221854d6eA4171372';

describe('EvmChainDataProvider.getTransactionDetails (live Base mainnet)', () => {
  it('reads a real, recent transaction with sane decoded sender/destination/calldata', async () => {
    const poolReader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const latest = await poolReader.getLatestBlockNumber();
    const events = await poolReader.getSwapEvents(WETH_USDC_POOL, latest - 2000n, latest);
    expect(events).not.toBeNull();
    expect(events!.length).toBeGreaterThan(0);

    const provider = new EvmChainDataProvider({ chain: CHAIN, rpcUrl: RPC_URL });
    const details = await provider.getTransactionDetails(events![0]!.txHash);

    expect(details).not.toBeNull();
    expect(details!.from).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // A swap's top-level `to` is a router or the pool itself — some real contract, not
    // a contract-creation (null) transaction.
    expect(details!.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(typeof details!.value).toBe('bigint');
    expect(details!.data.startsWith('0x')).toBe(true);
    expect(details!.data.length).toBeGreaterThan(10); // real calldata, not an empty transfer
  }, 30_000);

  it('returns null for a well-formed but nonexistent transaction hash — never fabricated', async () => {
    const provider = new EvmChainDataProvider({ chain: CHAIN, rpcUrl: RPC_URL });
    const details = await provider.getTransactionDetails(`0x${'0'.repeat(64)}`);
    expect(details).toBeNull();
  }, 20_000);
});
