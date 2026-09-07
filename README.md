# Fomo (working title)

A social crypto discovery and trading platform. Phase 0 built the production foundation;
Phase 1 added the first real product surface — market discovery for a curated set of real
tokens on Base, with genuine on-chain price/liquidity/volume, not mock data (see
`docs/MARKET_DATA.md`). Phase 2 added the social layer — real trading activity as a live
feed, wallet-first trader identity and profiles, follows, and activity-based trending — on
the same indexed data. **Phase 3 closes the loop**: connect a wallet, prove ownership with a
real signature (SIWE), get a real executable quote, review it, sign and broadcast the
transaction yourself, and watch it confirm — all non-custodially, Fomo's backend never
holding a key or signing anything. See `docs/TRADING.md` for exactly how, `docs/SOCIAL.md`
for Phase 2's, and the architecture spec for the product vision and roadmap beyond this.

Not yet built: comments, notifications delivery, multi-chain execution, email/passkey login.
See [`docs/`](./docs) and the roadmap for when each lands.

## Repository structure

```text
apps/
  web/        Next.js app — Discover (/), token detail (/market/[address]), trader profiles
              (/trader/[address]), and (Phase 3) trade history (/trades, /trades/[id]) are
              real. The live activity feed, follow/like mutations, and all wallet/trading
              calls are the places the browser talks to the API directly — see
              docs/SOCIAL.md#realtime and docs/TRADING.md.
  api/        NestJS modular monolith — Market (read-only), Identity (anonymous sessions +
              Phase 3 wallet-ownership verification), Social (activity/trending/follows/
              likes), and Trading (quotes/transactions/history, see docs/TRADING.md) are
              real; Notifications remains an empty module boundary.
  workers/    Independently deployable process. Runs real market-data ingestion on a
              timer (apps/workers/src/market/) — see docs/MARKET_DATA.md — captures trader
              identity and publishes a realtime activity ping (docs/SOCIAL.md), and (Phase
              3) sweeps PENDING trades for a real on-chain receipt (apps/workers/src/trading/).

packages/
  config/          Shared tsconfig, ESLint, and Tailwind presets.
  domain/          Shared TypeScript types, Zod schemas, parseEnv(), the Discovery Score /
                    staleness logic market ranking is built on, trader identity types,
                    activity-cursor pagination, the Trending Score (Phase 2), and (Phase 3)
                    the SIWE message builder and fee/slippage/price-impact math.
  db/              Prisma schema, migrations, and a shared PrismaClient singleton.
  ui/              Shared React components (Button, Surface) and the `cn()` helper.
  chain-adapters/  ChainDataProvider (generic EVM reads) + UniswapV3PoolReader (Phase 1's
                    pool/swap reads) + the pure price/liquidity math, unit-tested
                    separately from the RPC calls.

docs/         Architectural principles — read before extending the schema or auth.
```

Package boundaries map onto future service boundaries on purpose — see
`docs/SOURCE_OF_TRUTH.md` and `docs/CHAIN_ADAPTERS.md`.

## Prerequisites

- Node.js 20+ (`.node-version` pins the exact version)
- pnpm 9 — via Corepack (`corepack enable`) or `npm install -g pnpm`
- Docker (for local Postgres + Redis via `docker-compose.yml`)

## Local setup

```bash
pnpm install

cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
cp apps/workers/.env.example apps/workers/.env
# The default CHAIN_RPC_URL (Base's public RPC) works with no signup — fine for local dev.

docker compose up -d              # Postgres (+ TimescaleDB) and Redis
pnpm db:migrate:deploy            # applies every migration, Phase 0 through Phase 3
pnpm dev                          # runs web, api, and workers together, via Turborepo
```

- Web: http://localhost:3000 — Discover populates itself once the worker's first
  ingestion tick completes (seeds the tracked markets, then backfills ~24h of real swap
  history — takes a minute or two on first run, see `docs/MARKET_DATA.md`).
- API: http://localhost:4000 (health check: http://localhost:4000/health)
- Workers: no HTTP surface — watch the logs for seeding/ingestion progress.

Run a single app instead of all three with Turborepo's filter flag, e.g.
`pnpm --filter @fomo/api dev`.

## Environment variables

Each app documents its own required variables in its `.env.example` (`apps/web`,
`apps/api`, `apps/workers`). All of them are validated at boot with Zod
(`packages/domain`'s `parseEnv`) — a missing or malformed required variable fails
immediately with a clear message naming exactly what's wrong, rather than failing later at
the point of use. **Never commit `.env` files** (`.gitignore` already excludes them) and
never hardcode an RPC URL, API key, database credential, or secret anywhere in source.

## Database

PostgreSQL 16 with the TimescaleDB extension (declared in
`packages/db/prisma/schema.prisma` via Prisma's `postgresqlExtensions` preview feature).
`candles` is a real Timescale hypertable as of the Phase 1 migration.

```bash
pnpm db:generate         # regenerate the Prisma client after a schema change
pnpm db:migrate:dev       # create + apply a new migration locally
pnpm db:migrate:deploy    # apply existing migrations (production/CI)
pnpm db:studio            # browse the database
```

Phase 0's migration creates `chains`, `tokens`, `token_markets`. Phase 1's adds `swaps`,
`candles`, `ingestion_cursors`, and price/liquidity/volume columns on `token_markets`.
Phase 2's adds `wallets`, `users`, `follows`, `activity_likes`, plus
`trader_address`/`sender_address` on `swaps` and `trade_count_24h`/`unique_traders_24h` on
`token_markets`. Phase 3's (`20260906180000_wallet_trading`) adds `wallet_challenges`,
`trade_quotes`, `trade_transactions`, links a `Wallet` to a `User` only after signature
verification (`wallets.user_id`/`verified_at`), and drops the always-`null`
`users.wallet_address` column Phase 2 never actually populated — all additive/nullable
where the fact predates the migration, per `docs/SOCIAL.md`/`docs/TRADING.md`. See
`docs/SOURCE_OF_TRUTH.md` for why token metadata fields are nullable rather than defaulted
and why price/liquidity live on `token_markets` rather than `tokens`, `docs/MARKET_DATA.md`
for the Phase 1 tables, `docs/SOCIAL.md` for Phase 2's, and `docs/TRADING.md` for Phase 3's.

## Testing

```bash
pnpm test                            # every package's unit tests (now includes component
                                      # tests in apps/web via @testing-library/react + jsdom)
pnpm --filter @fomo/api test:e2e     # API e2e tests — requires docker compose up -d
```

See `docs/TESTING.md` for what's covered where and why the e2e suite is a separate step.

## Linting, type checking, building

```bash
pnpm lint
pnpm typecheck
pnpm build
```

All three run through Turborepo, so each only re-runs for packages that actually changed.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`:
install → lint → typecheck → validate & apply migrations (against real Postgres/Redis
service containers) → unit tests → API e2e tests (health, `/market`, `/social` +
`/identity`, and `/trade` — the last two with real ECDSA signatures and a placeholder 0x
API key, seeded against that same live database) → build. Any failure blocks the merge.

## Deployment

See `docs/DEPLOYMENT.md` for the full runbook — Vercel (web), Fly.io (API and workers, via
their `Dockerfile`s), Neon (Postgres), Upstash (Redis).

## Architectural boundaries

- **`apps/web` never reads the database directly** — only the API, and only in Server
  Components/Route Handlers for read-only data (`API_BASE_URL` is server-only, never sent
  to the browser). The deliberate exceptions are Phase 2's live activity stream and
  follow/like mutations, and Phase 3's wallet-ownership and trading calls (all of which
  structurally require a real browser-to-API connection, and the browser's own wagmi
  connection reading the connected wallet's chain/balance directly) — see
  `docs/SOCIAL.md#realtime`, `docs/TRADING.md`, and the separate, explicitly-public
  `NEXT_PUBLIC_API_BASE_URL`/`NEXT_PUBLIC_CHAIN_RPC_URL`.
- **`apps/api` is a modular monolith, not microservices.** `Identity` (now including
  Phase 3 wallet-ownership), `Social`, and `Trading` all have real logic; `Notifications`
  remains an empty module boundary; `Market` is read-only — it never writes, only the
  worker does. Same internal boundary as always, so any module can become its own service
  later without a rewrite — see the architecture spec.
- **`apps/workers` is deployed independently from `apps/api`** from day one, because
  indexing scales on a different axis (chain event volume) than request-serving
  (concurrent users).
- **Chain-specific code lives only in `packages/chain-adapters`** — see
  `docs/CHAIN_ADAPTERS.md`.
- **No table is a second source of truth for a fact another table already owns** — see
  `docs/SOURCE_OF_TRUTH.md`.
- **The backend never custodies a private key or signs a transaction** — see
  `docs/WALLET_SECURITY.md` and, for how Phase 3's trading flow specifically upholds this,
  `docs/TRADING.md#non-custodial-security`.

## Full architecture

The product vision, full data model, phased roadmap beyond Phase 0, and the reasoning
behind each technology choice were captured in a separate architecture review before this
repository was scaffolded — it isn't tracked in this repo. What matters for building on
top of Phase 0 *is* checked in: the load-bearing principles live in [`docs/`](./docs)
(source-of-truth rules, wallet security, chain-adapter boundaries), and each phase's scope
is enforced in code as it's built, not just described in a document elsewhere.
