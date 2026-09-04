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

## Owners, as of Phase 0

| Fact | Owner | Notes |
| --- | --- | --- |
| Chain metadata | `chains` table | Enabled/disabled, RPC config reference — never a raw URL. |
| Token identity | `tokens` table | `symbol`/`name`/`decimals`/`logoUrl` are nullable — see below. |
| Liquidity venue | `token_markets` table | Price/liquidity belong to a *pool*, not a token — see the model doc in `packages/db/prisma/schema.prisma`. |

Phase 1+ adds indexer-derived facts (candles, transactions, swaps) and Phase 3+ adds
derived rollups (`positions`, `trader_stats`) — those are **rebuildable** from
`transactions`/`swaps`, never written directly, so a change to PnL logic never requires a
data migration to "fix" numbers baked in earlier.

## Never fabricate a chain-derived value

`Token.symbol`, `Token.name`, `Token.decimals`, and `Token.logoUrl` are nullable in the
schema on purpose. If the indexer hasn't confirmed a fact from the chain yet, the field is
`null` — application code must never substitute a guess, a placeholder string, or a
default like `decimals: 18` "because most tokens use that." `packages/chain-adapters`'
`getTokenMetadata()` follows the same rule: a field it can't read comes back `null`, never
a fabricated value (see its test in `packages/chain-adapters/src/evm-adapter.test.ts`).

## What this means when you add a table later

Before adding a new table or a new computed field, ask: does a fact like this already have
an owner? If yes, extend that owner or read through it — don't add a second place the same
fact can live. If a fact is a computation over data that already exists elsewhere
(a leaderboard, a portfolio total), model it as a *view* or a *rebuildable rollup*, not a
second source of truth that can drift from the first.
