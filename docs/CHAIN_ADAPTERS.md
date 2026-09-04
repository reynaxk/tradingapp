# Chain-adapter principles

`packages/chain-adapters` is the seam between chain-specific behavior and everything else
— business logic, the API, the database, the UI. V1 launches on exactly one chain. This
package exists so that adding a second chain later means writing one new class, not
touching `apps/api`, `apps/workers`, or `apps/web`.

## The contract

```ts
interface ChainDataProvider {
  readonly chain: ChainDescriptor;
  isHealthy(): Promise<boolean>;
  getTokenMetadata(contractAddress: string): Promise<TokenMetadata>;
}
```

Anything that needs to read from a chain depends on this interface, never on a concrete
chain's SDK directly. `EvmChainDataProvider` (`packages/chain-adapters/src/evm-adapter.ts`)
is the only implementation today, built on `viem`. A Solana adapter later implements the
same interface on top of `@solana/web3.js` — the rest of the application doesn't change.

## Rules this package follows

- **It never reads `process.env` itself.** The caller resolves an RPC URL from
  config/secrets and passes it in (`EvmChainConfig.rpcUrl`). This keeps the package
  testable and keeps "where did this URL come from" traceable to one place per app.
- **It never fabricates a value.** `getTokenMetadata()` returns `null` for any field it
  can't confirm on-chain, using `Promise.allSettled` rather than letting one failed call
  fail the whole read. See `docs/SOURCE_OF_TRUTH.md`.
- **It stays small.** No plugin system, no dynamic chain registry loaded from config, no
  abstraction for behavior only one chain has ever needed. `ChainAdapterRegistry` is a
  plain `Map` — the consuming app decides how adapters get constructed and looked up.
- **It never implements indexing, trading, or persistence.** This package answers "what
  does this chain say right now" — nothing about turning that into stored rows (that's
  `apps/workers`) or executing a trade (that's the future `TradingModule`, Phase 3).

## Where it's used today

`apps/workers/src/main.ts` constructs one `EvmChainDataProvider` from `CHAIN_*`
environment variables at boot and logs whether its RPC is reachable — proving the wiring
works end to end without implementing any indexing logic yet. The real indexer (Phase 1)
and, later, a `SwapProvider`-style interface for trade routing (Phase 3) build on this same
seam.
