/**
 * Pure math only — no RPC calls. Kept separate from `uniswap-v3.ts` (which does the
 * actual chain reads) so price/liquidity derivation can be unit-tested without a network.
 * Verified against an independent source (DexScreener) during development: for the real
 * Base WETH/USDC pool, this math reproduced the reported price and liquidity to within
 * ~0.005% — see docs/MARKET_DATA.md#price-methodology.
 */

const Q96 = 2 ** 96;

/**
 * Uniswap V3 encodes price as sqrt(token1/token0) * 2^96, in raw (pre-decimals) units.
 * Returns the price of token1 in terms of token0, decimal-adjusted — e.g. for a
 * WETH(token0)/USDC(token1) pool, this is USDC per WETH: the WETH/USD price.
 *
 * Returns null (never a guess) if the pool is uninitialized (sqrtPriceX96 === 0n) or if
 * either decimals value is out of the plausible ERC-20 range.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  if (!Number.isInteger(token0Decimals) || !Number.isInteger(token1Decimals)) return null;
  if (token0Decimals < 0 || token0Decimals > 255 || token1Decimals < 0 || token1Decimals > 255) {
    return null;
  }

  const sqrtPrice = Number(sqrtPriceX96) / Q96;
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) return null;

  const rawRatio = sqrtPrice * sqrtPrice; // token1 per token0, raw (pre-decimals) units
  const price = rawRatio * 10 ** (token0Decimals - token1Decimals);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * USD value of a pool's two token balances, given each token's already-resolved USD
 * price. Returns null if either price is unresolved — a pool with one unpriceable side
 * has no honest total, so we don't publish a half-computed number.
 */
export function computePoolLiquidityUsd(
  balance0Raw: bigint,
  decimals0: number,
  price0Usd: number | null,
  balance1Raw: bigint,
  decimals1: number,
  price1Usd: number | null,
): number | null {
  if (price0Usd === null || price1Usd === null) return null;
  const amount0 = Number(balance0Raw) / 10 ** decimals0;
  const amount1 = Number(balance1Raw) / 10 ** decimals1;
  const total = amount0 * price0Usd + amount1 * price1Usd;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

/** price * on-chain total supply. Null if supply or price is unresolved. FDV, not
 *  circulating market cap — see docs/MARKET_DATA.md for the distinction. */
export function computeFullyDilutedMarketCapUsd(
  totalSupplyRaw: bigint,
  decimals: number,
  priceUsd: number | null,
): number | null {
  if (priceUsd === null) return null;
  const supply = Number(totalSupplyRaw) / 10 ** decimals;
  const cap = supply * priceUsd;
  return Number.isFinite(cap) && cap >= 0 ? cap : null;
}

/**
 * Converts a raw signed swap amount (as reported by the pool's Swap event) to a decimal
 * number. Uniswap V3 reports the *pool's* delta: positive means the pool received that
 * token, negative means the pool paid it out.
 */
export function rawAmountToDecimal(amountRaw: bigint, decimals: number): number {
  return Number(amountRaw) / 10 ** decimals;
}
