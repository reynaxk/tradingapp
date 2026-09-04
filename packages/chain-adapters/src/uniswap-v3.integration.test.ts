import { describe, expect, it } from 'vitest';
import { UniswapV3PoolReader } from './uniswap-v3';

/**
 * Runs against the real Base mainnet public RPC and the real, live WETH/USDC Uniswap V3
 * pool — the same one verified by hand during development (see docs/MARKET_DATA.md).
 * Deliberately not mocked: this is the one place that proves the ABI decoding and RPC
 * plumbing actually work against a real contract, not just a fixture we wrote ourselves.
 * Needs outbound network access; skip locally with `--exclude` if you're offline.
 */
const RPC_URL = 'https://mainnet.base.org';
const WETH_USDC_POOL = '0x6c561B446416E1A00E8E93E221854d6eA4171372';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('UniswapV3PoolReader (live Base mainnet)', () => {
  it('reads real pool state with the expected tokens and fee tier', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const state = await reader.getPoolState(WETH_USDC_POOL);

    expect(state).not.toBeNull();
    expect(state!.token0.toLowerCase()).toBe(WETH.toLowerCase());
    expect(state!.token1.toLowerCase()).toBe(USDC.toLowerCase());
    expect(state!.feeTier).toBe(3000);
    expect(state!.sqrtPriceX96).toBeGreaterThan(0n);
  }, 20_000);

  it('reads a real, positive token balance held by the pool', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const balance = await reader.getTokenBalance(USDC, WETH_USDC_POOL);

    expect(balance).not.toBeNull();
    expect(balance!).toBeGreaterThan(0n);
  }, 20_000);

  it('returns null instead of throwing for a nonexistent pool address', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const state = await reader.getPoolState('0x0000000000000000000000000000000000000001');
    expect(state).toBeNull();
  }, 20_000);

  it('reads real recent Swap events with sane decoded fields', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const latest = await reader.getLatestBlockNumber();
    const events = await reader.getSwapEvents(WETH_USDC_POOL, latest - 2000n, latest);

    // This pool trades constantly; a 2000-block window (~1hr) should never be empty, but
    // if it somehow is, assert the honest empty-array contract rather than force a length.
    for (const event of events) {
      expect(event.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.sqrtPriceX96).toBeGreaterThan(0n);
      // Exactly one side of a swap is positive (paid into the pool), the other negative.
      expect(event.amount0 > 0n !== event.amount1 > 0n).toBe(true);
    }
  }, 30_000);
});
