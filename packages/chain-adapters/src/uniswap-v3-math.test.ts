import { describe, expect, it } from 'vitest';
import {
  computeFullyDilutedMarketCapUsd,
  computePoolLiquidityUsd,
  priceFromSqrtPriceX96,
  rawAmountToDecimal,
} from './uniswap-v3-math';

// Real values read from the live WETH/USDC Uniswap V3 pool on Base
// (0x6c561B446416E1A00E8E93E221854d6eA4171372) during development, and independently
// cross-checked against DexScreener's own reported price/liquidity for the same pool
// (agreed to within ~0.005%). Not synthetic fixtures.
const REAL_SQRT_PRICE_X96 = 3925780777441105867125557n;
const REAL_WETH_DECIMALS = 18;
const REAL_USDC_DECIMALS = 6;
const REAL_WETH_BALANCE_RAW = 19726284265000000000000n; // 19726.284265 WETH
const REAL_USDC_BALANCE_RAW = 69133727180000n; // 69,133,727.18 USDC

describe('priceFromSqrtPriceX96', () => {
  it('reproduces the real, independently-verified WETH/USD price', () => {
    const price = priceFromSqrtPriceX96(REAL_SQRT_PRICE_X96, REAL_WETH_DECIMALS, REAL_USDC_DECIMALS);
    expect(price).not.toBeNull();
    expect(price!).toBeCloseTo(2455.23, 0);
  });

  it('returns null for an uninitialized pool (sqrtPriceX96 = 0)', () => {
    expect(priceFromSqrtPriceX96(0n, 18, 6)).toBeNull();
  });

  it('returns null rather than a fabricated number for out-of-range decimals', () => {
    expect(priceFromSqrtPriceX96(REAL_SQRT_PRICE_X96, -1, 6)).toBeNull();
    expect(priceFromSqrtPriceX96(REAL_SQRT_PRICE_X96, 18, 256)).toBeNull();
  });
});

describe('computePoolLiquidityUsd', () => {
  it('reproduces the real, independently-verified pool liquidity', () => {
    // Expected value is 19726.284265 * 2455.23 + 69133727.18, computed independently —
    // not copied from the function under test. The balances above are themselves rounded
    // to 6dp for readability, so this checks agreement to the dollar, not the cent.
    const liq = computePoolLiquidityUsd(
      REAL_WETH_BALANCE_RAW,
      REAL_WETH_DECIMALS,
      2455.23,
      REAL_USDC_BALANCE_RAW,
      REAL_USDC_DECIMALS,
      1,
    );
    expect(liq).not.toBeNull();
    expect(liq!).toBeCloseTo(19726.284265 * 2455.23 + 69133727.18, 0);
  });

  it('returns null rather than a half-computed total when one side is unpriced', () => {
    expect(computePoolLiquidityUsd(100n, 18, null, 100n, 6, 1)).toBeNull();
    expect(computePoolLiquidityUsd(100n, 18, 1, 100n, 6, null)).toBeNull();
  });
});

describe('computeFullyDilutedMarketCapUsd', () => {
  it('multiplies decimal-adjusted supply by price', () => {
    const oneMillionTokensAt18Decimals = 1_000_000n * 10n ** 18n;
    const cap = computeFullyDilutedMarketCapUsd(oneMillionTokensAt18Decimals, 18, 2.5);
    expect(cap).toBeCloseTo(2_500_000, 0);
  });

  it('returns null when price is unresolved, never zero', () => {
    const oneMillionTokensAt18Decimals = 1_000_000n * 10n ** 18n;
    expect(computeFullyDilutedMarketCapUsd(oneMillionTokensAt18Decimals, 18, null)).toBeNull();
  });
});

describe('rawAmountToDecimal', () => {
  it('converts a raw signed amount by decimals', () => {
    expect(rawAmountToDecimal(99000000000000000n, 18)).toBeCloseTo(0.099, 6);
    expect(rawAmountToDecimal(-241957276n, 6)).toBeCloseTo(-241.957276, 6);
  });
});
