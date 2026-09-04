# Fomo (working title)

A social crypto discovery and trading platform. Phase 0 built the production foundation;
**Phase 1 adds the first real product surface** — market discovery for a curated set of
real tokens on Base, with genuine on-chain price/liquidity/volume, not mock data. See
`docs/MARKET_DATA.md` for exactly how, and the architecture spec for the product vision
and roadmap beyond this.

Not yet built: wallets, trading/swap execution, social features, notifications,
multi-chain support. See [`docs/`](./docs) and the roadmap for when each lands.

## Repository structure

```text
apps/
  web/        Next.js app — Discover (/) and token detail (/market/[address]) are real.
  api/        NestJS modular monolith — Market is real (read-only); Identity · Social ·
              Trading · Notifications are still empty module boundaries.
  workers/    Independently deployable process. Runs real market-data ingestion on a
              timer (apps/workers/src/market/) — see docs/MARKET_DATA.md.

packages/
  config/          Shared tsconfig, ESLint, and Tailwind presets.
  domain/          Shared TypeScript types, Zod schemas, parseEnv(), and the Discovery
                    Score / staleness logic market ranking is built on.
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
pnpm db:migrate:deploy            # applies both migrations, including the Phase 1 one
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

Phase 0's migration creates `chains`, `tokens`, `token_markets`. Phase 1's adds
`swaps`, `candles`, `ingestion_cursors`, and price/liquidity/volume columns on
`token_markets`. See `docs/SOURCE_OF_TRUTH.md` for why token metadata fields are nullable
rather than defaulted and why price/liquidity live on `token_markets` rather than
`tokens`, and `docs/MARKET_DATA.md` for the Phase 1 tables specifically.

## Testing

```bash
pnpm test                            # every package's unit tests
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
service containers) → unit tests → API e2e tests (health + the full `/market` route
family, seeded against that same live database) → build. Any failure blocks the merge.

## Deployment

See `docs/DEPLOYMENT.md` for the full runbook — Vercel (web), Fly.io (API and workers, via
their `Dockerfile`s), Neon (Postgres), Upstash (Redis).

## Architectural boundaries

- **`apps/web` never reads the database or a blockchain RPC directly** — only the API,
  and only in Server Components/Route Handlers (`API_BASE_URL` is server-only, never sent
  to the browser).
- **`apps/api` is a modular monolith, not microservices.** `Identity`, `Social`,
  `Trading`, and `Notifications` are separate Nest modules, still empty; `Market` is the
  first one with real logic, and it's read-only — it never writes, only the worker does.
  Same internal boundary as always, so any module can become its own service later
  without a rewrite — see the architecture spec.
- **`apps/workers` is deployed independently from `apps/api`** from day one, because
  indexing scales on a different axis (chain event volume) than request-serving
  (concurrent users).
- **Chain-specific code lives only in `packages/chain-adapters`** — see
  `docs/CHAIN_ADAPTERS.md`.
- **No table is a second source of truth for a fact another table already owns** — see
  `docs/SOURCE_OF_TRUTH.md`.
- **The backend never custodies a private key or signs a transaction** — see
  `docs/WALLET_SECURITY.md`.

## Full architecture

The product vision, full data model, phased roadmap beyond Phase 0, and the reasoning
behind each technology choice were captured in a separate architecture review before this
repository was scaffolded — it isn't tracked in this repo. What matters for building on
top of Phase 0 *is* checked in: the load-bearing principles live in [`docs/`](./docs)
(source-of-truth rules, wallet security, chain-adapter boundaries), and each phase's scope
is enforced in code as it's built, not just described in a document elsewhere.
