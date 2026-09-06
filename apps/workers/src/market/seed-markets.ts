/**
 * Phase 1's bounded, curated set of markets to track on Base (eip155:8453) — see
 * docs/MARKET_DATA.md#token-discovery for why a curated seed list rather than scanning
 * every pool the factory has ever created.
 *
 * Deliberately minimal: only addresses. Every pool below was read directly on-chain
 * (token0/token1/slot0, all initialized) via the Base public RPC during development, and
 * cross-checked for real liquidity via DexScreener — but DexScreener was used only to
 * *find* candidate pools, never as a source for price, liquidity, or token metadata. All
 * of that — symbol, name, decimals — is resolved live from the contracts themselves by
 * the ingestion worker, never hardcoded here, so there is nothing in this file that could
 * be a stale or wrong "fact" about a token.
 *
 * Order matters: a market's quote token must already have a resolved USD price by the
 * time its own market is processed (see resolveUsdPrice in ingest.ts). USDC-quoted
 * markets can go in any order; WETH-quoted markets must come after the WETH/USDC market.
 */

/** Treated as pegged 1:1 to USD — a Phase 1 simplification, not a depeg-aware oracle. */
export const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export interface SeedMarket {
  /** The pool contract to read price/liquidity/swaps from. */
  poolAddress: string;
  /** Which of the pool's two tokens is the one being tracked ("discovered"); the other
   *  is this market's quote token. */
  baseTokenAddress: string;
  dex: 'uniswap-v3';
}

export const BASE_SEED_MARKETS: SeedMarket[] = [
  {
    // WETH/USDC — resolves WETH's USD price, which DEGEN and BRETT below depend on.
    poolAddress: '0x6c561B446416E1A00E8E93E221854d6eA4171372',
    baseTokenAddress: '0x4200000000000000000000000000000000000006',
    dex: 'uniswap-v3',
  },
  {
    // cbBTC/USDC
    poolAddress: '0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef',
    baseTokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    dex: 'uniswap-v3',
  },
  {
    // DEGEN/WETH
    poolAddress: '0x0cA6485b7e9cF814A3Fd09d81672B07323535b64',
    baseTokenAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    dex: 'uniswap-v3',
  },
  {
    // BRETT/WETH
    poolAddress: '0xBA3F945812a83471d709BCe9C3CA699A19FB46f7',
    baseTokenAddress: '0x532f27101965dd16442E59d40670FaF5eBB142E4',
    dex: 'uniswap-v3',
  },
];
