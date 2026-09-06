# Source-of-truth rules

Every important fact in this system has exactly one owner. No layer recomputes or
re-derives a fact another layer already owns — that's how two screens end up disagreeing
about a balance. This is not a style preference; violating it is the failure mode that
erodes trust in a product whose entire pitch is "here's what's really happening."

## The general flow

```text
Blockchain
    ↓
Indexer (apps/workers)
    ↓
Normalized on-chain events
    ↓
Database (packages/db — Postgres, source of truth for everything downstream)
    ↓
API (apps/api — reads the database, never recomputes a fact from raw chain data itself)
    ↓
Web (apps/web — reads the API, never reads chain data or the database directly)
```

The frontend never talks to an RPC node or a DEX API for aggregate data (prices, holder
counts, trending). It always reads our API, because the API is the only place ranking,
caching, and response times can be controlled regardless of chain congestion. See
`docs/CHAIN_ADAPTERS.md` for the one exception (client-side wallet signing).

## The trading flow

```text
Wallet
    ↓
Quote / routing provider (an aggregator API, proxied by apps/api — never our own AMM math)
    ↓
Unsigned transaction
    ↓
User's wallet signs it (client-side only — see docs/WALLET_SECURITY.md)
    ↓
Blockchain
    ↓
Indexer observes the confirmed transaction
    ↓
Database
    ↓
API
    ↓
UI
```

A trade's outcome is only ever true once the indexer has observed it on-chain. The API
never marks a trade "complete" from the client's optimistic submission alone.

## Owners, as of Phase 2

| Fact | Owner | Notes |
| --- | --- | --- |
| Chain metadata | `chains` table | Enabled/disabled, RPC config reference — never a raw URL. |
| Token identity | `tokens` table | `symbol`/`name`/`decimals`/`logoUrl` are nullable — see below. |
| Liquidity venue | `token_markets` table | Price/liquidity belong to a *pool*, not a token — see the model doc in `packages/db/prisma/schema.prisma`. |
| On-chain swaps | `swaps` table | Authoritative, indexed Swap events — see `docs/MARKET_DATA.md`. Idempotency key `(chain_id, tx_hash, log_index)`. Also the authoritative source for Phase 2's social activity feed — see `docs/SOCIAL.md#activity-model`; a feed item is a read-time projection of a `Swap` row, never a second copy. |
| Historical OHLCV | `candles` table | **Rebuildable** from `swaps` — recomputed, not appended, every ingestion tick. Never written any other way. |
| Current price/liquidity/volume/24h-change/trending stats | `token_markets`'s own columns | A **cache**, refreshed from `swaps`/`candles` every tick — the raw history in `swaps` is what's actually authoritative. `trade_count_24h`/`unique_traders_24h` (Phase 2) follow the exact same rule as `volume_24h_usd`. |
| Ingestion progress | `ingestion_cursors` table | One row per market; the only state a restart needs to resume correctly. |
| Trader identity | `wallets` table | Wallet-first (see `docs/WALLET_SECURITY.md`) — created lazily by the worker the first time an address is observed trading, never by a user action. See `docs/SOCIAL.md#trader-identity`. |
| Authenticated accounts | `users` table | Optional layer above `Wallet`; Phase 2's session is anonymous (no wallet-ownership claim) — see `docs/SOCIAL.md#authentication`. |
| Follow relationships | `follows` table | `(userId, walletAddress)` unique — see `docs/SOCIAL.md#follow-system`. |
| Activity likes | `activity_likes` table | Keyed off `Swap.id`, not a copy of it — see `docs/SOCIAL.md#social-signals`. |

Phase 3+ adds `transactions` and derived rollups (`positions`, real PnL) on the same
principle: **rebuildable** from raw history, never written directly, so a change to PnL
logic never requires a data migration to "fix" numbers baked in earlier. `swaps`/`candles`
(Phase 1) and the Phase 2 tables above already follow this pattern — it isn't new in a
later phase, just applied again. Trader stats in Phase 2 (`docs/SOCIAL.md#trader-stats`)
deliberately stop short of PnL/ROI/win-rate for exactly this reason: Fomo has no cost-basis
data yet, so those numbers aren't rebuildable from anything real.

## Never fabricate a chain-derived value

`Token.symbol`, `Token.name`, `Token.decimals`, and `Token.logoUrl` are nullable in the
schema on purpose. If the indexer hasn't confirmed a fact from the chain yet, the field is
`null` — application code must never substitute a guess, a placeholder string, or a
default like `decimals: 18` "because most tokens use that." `packages/chain-adapters`'
`getTokenMetadata()` follows the same rule: a field it can't read comes back `null`, never
a fabricated value (see its test in `packages/chain-adapters/src/evm-adapter.test.ts`).

The same discipline applies to market data as of Phase 1 — `priceUsd`, `liquidityUsd`,
`marketCapUsd`, and `priceChange24hPct` on `TokenMarket` are all `null` (not `0`, not a
guess) whenever they can't be honestly computed. See `docs/MARKET_DATA.md` for exactly
which conditions produce a `null` and why.

## What this means when you add a table later

Before adding a new table or a new computed field, ask: does a fact like this already have
an owner? If yes, extend that owner or read through it — don't add a second place the same
fact can live. If a fact is a computation over data that already exists elsewhere
(a leaderboard, a portfolio total), model it as a *view* or a *rebuildable rollup*, not a
second source of truth that can drift from the first.
