# Market data — Phase 1

How Fomo knows what a token is worth, how liquid it is, and why it's ranked where it is.
Read this before touching `packages/db/prisma/schema.prisma`'s market tables,
`apps/workers/src/market/`, or `apps/api/src/market/`.

## Architecture

```text
Blockchain (Base mainnet)
    ↓
packages/chain-adapters (UniswapV3PoolReader — the only place with pool-specific RPC logic)
    ↓
apps/workers/src/market/ingestion.ts (seed → price/liquidity snapshot → swap backfill → candles)
    ↓
packages/db (chains, tokens, token_markets, swaps, candles, ingestion_cursors)
    ↓
apps/api/src/market (read-only REST — never writes)
    ↓
apps/web (Discover, /market/[address] — never touches the chain or the database directly)
```

Same shape as `docs/SOURCE_OF_TRUTH.md`'s general flow, filled in for Phase 1's actual
tables.

## Supported chain

One: Base mainnet (`eip155:8453`), per the Phase 1 scope limit. `CHAIN_RPC_URL` in
`apps/workers/.env.example` defaults to Base's own public RPC (`mainnet.base.org`) — free,
no signup, genuinely used throughout development (see below). It rate-limits under
sustained concurrent load; point production at a dedicated provider instead.

## Token discovery: a curated seed list, not a scan

`apps/workers/src/market/seed-markets.ts` lists four real, verified Base markets — not a
placeholder set. Each pool address was read directly on-chain (`token0`/`token1`/`slot0`,
confirmed initialized) against the live Base public RPC during development, and
cross-checked for genuine liquidity via DexScreener's public API before being added.
**DexScreener was used only to discover which pools have real liquidity worth tracking —
never as a source for the price, liquidity, or token metadata Fomo actually publishes.**
All of that is read directly from the contracts by the ingestion worker; the seed file
itself stores nothing but addresses, deliberately, so there's no stale "fact" about a
token sitting in source control.

Why curated rather than scanning every pool a factory has ever created: Phase 1's stated
scope is "a bounded set of useful markets," and indexing arbitrary new pools safely means
solving spam/rug filtering, which is real work Phase 1 explicitly defers (see
"Deferred" below). Expanding the tracked set today means adding entries to
`seed-markets.ts`, not writing new ingestion logic.

Seed-list order matters: a market quoted in another tracked token (DEGEN/WETH,
BRETT/WETH) needs its quote token's USD price resolved before it can price itself. WETH's
own USDC-quoted market must appear earlier in the list than any WETH-quoted market — see
the comment in `seed-markets.ts`.

## Price methodology

Read `slot0().sqrtPriceX96` from the pool directly and derive price with
`priceFromSqrtPriceX96()` (`packages/chain-adapters/src/uniswap-v3-math.ts`) — pure,
unit-tested math, no RPC inside it. **Never borrowed from a third party.** Verified during
development against the real Base WETH/USDC pool
(`0x6c561B446416E1A00E8E93E221854d6eA4171372`): our own computation and DexScreener's
independently-reported price agreed to within ~0.005%. See
`uniswap-v3-math.test.ts` — the test fixtures are the real numbers from that check, not
synthetic ones.

USD resolution: USDC (`0x8335...02913` on Base) is treated as pegged 1:1 to USD — a Phase
1 simplification, not a depeg-aware oracle (see "Deferred"). Every other tracked token's
USD price is derived by walking the seed list in order: WETH prices off its USDC pool,
then DEGEN and BRETT price off their WETH pools using WETH's just-computed USD price. If a
quote token's price isn't resolved yet (seed-list ordering violated, or its own pool read
failed), the dependent market's refresh is skipped for that tick and its price is left as
whatever it was — never replaced with a guess.

**If a reliable price can't be established, the field is `null`.** Nothing in this
pipeline invents a plausible-looking number.

## Liquidity methodology

`computePoolLiquidityUsd()`: the pool contract's own token balances
(`balanceOf(poolAddress)` on each side), each converted to USD via the price resolution
above, summed. This is **total value currently held by the pool contract**, not a
concentrated-liquidity-aware TVL-in-range figure — Uniswap V3 liquidity is concentrated
around the current tick, and this number doesn't attempt to model that nuance. It's an
honest, simple, verifiable figure (also cross-checked against DexScreener's reported
liquidity for the same real pool, same ~0.005% agreement), not a precision instrument.

Null, not a fabricated total, when either side's price is unresolved.

## Market cap

`computeFullyDilutedMarketCapUsd()`: on-chain `totalSupply()` × price. This is **FDV
(fully diluted valuation), not circulating market cap** — Fomo has no way to know which
tokens are locked, burned, or held by a treasury versus genuinely circulating. Labeled
"Market cap" in the UI for familiarity, but if this distinction ever becomes
product-relevant, it needs a real circulating-supply source, not a bigger disclaimer.

## Volume and 24h price change

Computed from `swaps` — the authoritative, indexed history of real Swap events — never
estimated or borrowed. A market's `volume24hUsd` and `priceChange24hPct` on `TokenMarket`
are a **cache**, refreshed every ingestion tick from `candles` (itself rebuilt from
`swaps`); the raw swap rows are the source of truth, and both derived fields could be
dropped and recomputed from them at any time.

**`priceChange24hPct` is `null`, not `0%`, until the market has at least 24h of genuinely
indexed history** — a market seeded five minutes ago has no honest 24h-ago price to
compare against, and Phase 1 doesn't pretend otherwise (see `recomputeCandlesAndRollups`
in `ingestion.ts`, `haveFullDay`). The very first tick after seeding a market backfills the
last ~24h of real swap history (see "Indexing" below) specifically so this stops being
true quickly, not to fake it in the meantime.

**Known limitation — quote-token volume conversion:** a swap's USD volume is computed as
`|amount| × price-in-quote × quote's-current-USD-price`, using the quote token's price
*at ingestion time*, not at the historical time of that swap. For USDC-quoted markets
(WETH, cbBTC) this is always exact, since USDC is pegged. For WETH-quoted markets (DEGEN,
BRETT), a swap from an hour ago is valued at *this tick's* WETH/USD price, not the price
WETH actually had an hour ago. Disclosed here rather than silently wrong; the fix is
point-in-time quote pricing per swap, deferred (see below) since it requires indexing the
quote token's own price history at the same granularity, not just its current value.

## Indexing / ingestion

`apps/workers/src/market/ingestion.ts`, run on a timer (`MARKET_INGESTION_INTERVAL_SECONDS`,
default 60s):

```text
seed()                      — idempotent upsert of chain/tokens/markets/cursors
refreshPricesAndLiquidity() — current snapshot for every market, in seed-list order
ingestSwaps()                — incremental, cursor-based, chunked Swap-event backfill
```

Cursor-based and restartable: `ingestion_cursors` persists `last_processed_block` per
market. A tick advances the cursor in bounded chunks (`LOG_CHUNK_BLOCKS` = 5,000 blocks
per `eth_getLogs` call — the public RPC starts failing above roughly 10–50k;
`MAX_BLOCKS_PER_TICK` = 20,000 total per tick, so a large backfill spans several ticks
rather than blocking one). The cursor only advances *after* that chunk's swaps are
persisted, and every swap insert is idempotent
(`@@unique([chainId, txHash, logIndex])`, `skipDuplicates: true`) — a crash mid-chunk means
the next tick re-fetches and re-inserts the same range harmlessly, never duplicates or
corrupts state. A brand-new market's cursor starts at `latest block − ~24h of blocks`, so
its first tick backfills real recent history instead of starting from nothing.

Candles are recomputed (not appended) for the touched time range on every tick, directly
from `swaps` via a `time_bucket`-grouped `INSERT ... ON CONFLICT DO UPDATE` — see
`recomputeCandlesAndRollups`. Re-running it for the same range always produces the same
rows.

**Rate limiting:** the free public Base RPC throttles concurrent requests (observed
directly during development — see `docs/TESTING.md`). Every RPC call in the ingestion
path is sequenced with a small delay (`RPC_CALL_DELAY_MS`), not fired in parallel.

## Candle granularity and timeframes

Raw candles are 5-minute buckets, stored as a Timescale hypertable (`candles`, partitioned
on `bucket_start`). The `/market/tokens/:address/history` endpoint aggregates those into
the requested chart timeframe *at query time* via `time_bucket()` — 1H stays at 5m, 4H at
15m, 1D at 1h, 1W at 4h, 1M at 1d (see `TIMEFRAME_CONFIG` in `market.service.ts`) — rather
than pre-materializing every timeframe as its own table. Simpler to get right at Phase 1's
data volume; Timescale continuous aggregates are the documented upgrade path once raw-candle
volume makes query-time aggregation slow.

`swaps` is a plain indexed table, not (yet) a hypertable — its idempotency key
`(chain_id, tx_hash, log_index)` doesn't include `block_timestamp`, and TimescaleDB
requires the partitioning column be part of every unique constraint on a hypertable.
Fine at Phase 1's bounded market count; revisit when swap volume actually justifies it.

## Ranking (`/market/discover`)

```text
Discovery Score = 0.4 × log10(1 + volume24hUsd)
                + 0.3 × clamp(priceChange24hPct, −50, +50)
                + 0.3 × log10(1 + liquidityUsd)
```

Implemented once, in `packages/domain/src/market.ts` (`computeDiscoveryScore`,
`DISCOVERY_RANKING`), imported by both the API and (indirectly, by reading this doc) by
anyone trying to understand a ranking — not reimplemented or restated as a separate
"explanation" that could drift from the real formula.

- **Log-scaled volume/liquidity**: raw USD values span many orders of magnitude; without
  log-scaling, one large market would mathematically swamp the other two factors.
- **Clamped momentum** (±50 points): a tiny-liquidity market's percentage change can be
  enormous on a near-zero denominator (a $50 pool moving to $500 is "+900%" and means
  nothing) — clamping caps how much that single factor can move the score.
- **Liquidity gate** (`minLiquidityUsd` = $10,000): a market below this is excluded from
  ranked results entirely, not scored low. Protects against the exact "tiny illiquid token
  with an extreme percentage move" case Phase 1 was asked to guard against.
- **Staleness**: `isStale` (in `MarketSummary`) is `true` once `lastPriceUpdateAt` is
  older than 30 minutes (`isPriceStale` in `packages/domain`) — surfaced in the UI, not
  silently hidden.

Sort modes (`?sort=score|volume|liquidity|priceChange`) all apply the same liquidity gate;
they only change which factor orders the (already-gated) result set. See
`market.service.ts#discover` for why ranking is computed in application code rather than
SQL at Phase 1's market count, and the documented path off that once it stops being small.

## Search

Server-backed substring match (case-insensitive) on symbol, name, or an exact
(case-insensitive) contract-address match — `market.service.ts#search`. No client-side
loading of the token table; the web app's `SearchBar` is a plain GET form, not a
typeahead calling a client-exposed endpoint (see `docs/SOURCE_OF_TRUTH.md` — the browser
never talks to anything but the Next.js server, which talks to the API server-side).

## API endpoints

| Route | Notes |
| --- | --- |
| `GET /v1/market/discover` | `?sort=score\|volume\|liquidity\|priceChange&limit=1-100&search=` |
| `GET /v1/market/tokens/:address` | 404 if untracked, 400 if not address-shaped |
| `GET /v1/market/tokens/:address/history` | `?timeframe=1H\|4H\|1D\|1W\|1M`, empty array (not an error) when there's no history yet |
| `GET /v1/market/search` | `?q=&limit=1-50`, `q` required and non-empty |

## Real-time updates

Polling via `router.refresh()` on a client-side interval (`AutoRefresh`, 20–30s) against
Next.js's own revalidating server fetch — not a WebSocket. Deliberate: Phase 1's "don't
overengineer real-time" guidance, and the ingestion tick itself only runs every 60s, so a
push channel would have nothing new to say between ticks anyway. The seam is ready for a
future upgrade (the API already returns `lastPriceUpdateAt` for exactly this purpose) once
sub-minute ingestion makes push worth the complexity.

## Known limitations (Phase 1, as shipped)

- Only 4 markets tracked, on one chain, one DEX protocol (Uniswap V3 pools only —
  Aerodrome/Solidly-style pools use a different reserves model and aren't read).
- USDC is treated as exactly $1; no depeg detection.
- Non-USD-quoted markets' historical swap volume uses today's quote price, not the
  price at trade time (see "Volume and 24h price change" above).
- `marketCapUsd` is FDV, not circulating supply.
- Pool liquidity is total value held, not concentrated-liquidity-aware.
- No token risk/safety signals (honeypot detection, mint authority, etc.) — everything
  tracked here was manually vetted for real liquidity during development, not
  algorithmically screened.
- A market's price/liquidity only updates once per ingestion tick (default 60s) — the UI
  can be up to that far behind the chain.

## Deferred to later phases

Multi-chain, non-Uniswap-V3 DEX support, automated pool discovery/spam filtering, token
risk scoring, point-in-time quote pricing for swap volume, a circulating-supply source for
true market cap, Timescale continuous aggregates, converting `swaps` to a hypertable, and
genuine push-based real-time updates.
