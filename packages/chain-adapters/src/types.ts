/**
 * The seam between chain-specific behavior and everything else — business logic, the API,
 * the database, the UI. Adding a second chain later means writing one new class that
 * implements `ChainDataProvider`; it must never mean touching a module in apps/api,
 * apps/workers, or apps/web. See /docs/CHAIN_ADAPTERS.md.
 */

export interface ChainDescriptor {
  /** Stable, human-referenceable id, CAIP-2 style (e.g. "eip155:8453" for Base mainnet). */
  identifier: string;
  name: string;
  nativeSymbol: string;
}

/**
 * Token facts that only the chain itself can answer. Any field this package cannot
 * confirm on-chain comes back `null` — callers must never substitute a guess.
 */
export interface TokenMetadata {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}

export interface ChainDataProvider {
  readonly chain: ChainDescriptor;

  /** Cheap liveness check against the underlying RPC — used by health checks, not indexing. */
  isHealthy(): Promise<boolean>;

  /** Reads symbol/name/decimals directly from the token contract. Never fabricates a value. */
  getTokenMetadata(contractAddress: string): Promise<TokenMetadata>;
}

/** Looks up the adapter for a given chain identifier. Populated by the consuming app. */
export type ChainAdapterRegistry = ReadonlyMap<string, ChainDataProvider>;
