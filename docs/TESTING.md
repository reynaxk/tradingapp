# Testing

## What exists as of Phase 1

| Package/app | Runner | What's covered |
| --- | --- | --- |
| `packages/domain` | Vitest | Zod schema round-trips; `parseEnv`'s error formatting; the Discovery Score formula and staleness gate (`market.test.ts`). |
| `packages/chain-adapters` | Vitest (unit) | `EvmChainDataProvider` and `uniswap-v3-math.ts`'s price/liquidity/market-cap math — the latter checked against real numbers observed on a live pool, not synthetic fixtures. |
| `packages/chain-adapters` | Vitest (**live** integration) | `UniswapV3PoolReader` against the real Base mainnet RPC and a real, live Uniswap V3 pool — see below. |
| `apps/web` | Vitest | `lib/env.ts`'s validation; `lib/format.ts`'s price/percent/compact-USD formatting, including the locale bug this caught (see below). |
| `apps/api` | Jest (unit) | Env schema validation; the global exception filter's production-vs-development behavior. |
| `apps/api` | Jest (e2e) | `GET /health` and the full `/market` route family against a **live** Postgres and Redis — see below. |
| `apps/workers` | Vitest | Env schema validation. |
| `packages/db` | — | No unit tests; correctness is verified by CI actually applying the migration (see below), not by mocking Prisma. |

## Running tests locally

```bash
pnpm test          # every package's unit tests, via Turborepo
pnpm --filter @fomo/api test:e2e   # requires docker compose up -d first
```

The e2e suite boots the real `AppModule`, so it needs a reachable `DATABASE_URL` and
`REDIS_URL` (`docker compose up -d` provides both locally with the defaults in
`apps/api/.env.example`). It isn't part of `pnpm test` for that reason — it's a separate,
explicit step both locally and in CI.

## The live-RPC integration test

`packages/chain-adapters/src/uniswap-v3.integration.test.ts` is deliberately not mocked —
it calls the real Base public RPC and reads the real WETH/USDC pool
(`0x6c561B446416E1A00E8E93E221854d6eA4171372`), asserting the decoded tokens, fee tier, and
recent Swap events are what they actually are on-chain. This is the one place proving the
ABI encoding/decoding is correct against a real contract rather than a fixture the same
person who wrote the reader also wrote. It needs outbound network access; if you're
offline, skip it with `vitest run --exclude '**/*.integration.test.ts'`.

## Migration verification

There's no live database in every environment this project gets built in, so migration
correctness isn't "trust me" — CI applies the actual migration SQL (both Phase 0's and
Phase 1's) to a real, disposable Postgres+Timescale service container on every run
(`prisma migrate deploy`, see `.github/workflows/ci.yml`) before running the e2e suite
against it. If a migration is broken, CI fails there, not later. Phase 1's migration also
converts `candles` into a real Timescale hypertable (`create_hypertable`) as part of that
same file — see `packages/db/prisma/migrations/20260904130000_market_data/migration.sql`.

## What actually caught bugs during development

Worth recording, since it's the point of testing rather than a formality:

- The swap-ingestion price calculation initially hardcoded the quote token's decimals as
  `18` — correct for WETH, silently wrong for USDC (6 decimals). Caught by re-reading the
  code with the same rigor as the audit process, before it ever ran, not by a test — noted
  here because it's exactly the class of bug the unit tests for `uniswap-v3-math.ts`
  exist to catch for the *math*, even though this particular one was in the *wiring*
  around it.
- Two of the price-math test fixtures themselves had bugs (a rounding mismatch from
  reconstructing a raw balance from a display-rounded string, and a missing group of zeros
  in a raw-amount literal) — caught by the tests failing on first run, exactly as
  intended, then fixed before trusting the "passing" result.
- The worker's Redis connectivity check had no error handling, unlike the parallel
  Postgres check — an unreachable Redis at boot crashed the whole worker process instead
  of reporting degraded status. Found by actually running the compiled worker against an
  unreachable Redis, not by inspection (this was a Phase 0 bug, fixed during the Phase 0
  audit, but recorded here because it's the same "actually run it" principle this section
  is about).
- `apps/web`'s "Last updated" timestamp used `Date.prototype.toLocaleString()` with no
  locale argument, which renders however the *host process's* locale happens to be set —
  it showed a Russian-locale timestamp in one environment during a real browser check.
  Every other formatter in `lib/format.ts` already passed `'en-US'` explicitly; this one
  didn't. Fixed, and `format.test.ts` now has a regression test asserting the exact
  `en-US` output for a fixed input date, specifically so a locale-dependent formatter
  can't reappear silently.

## What's deliberately not tested yet

No wallet, trading, or social-feature tests exist because those features don't exist yet
(see the roadmap in the architecture spec). Adding tests ahead of the feature they cover
is its own kind of premature complexity. Similarly, `apps/workers/src/market/ingestion.ts`
itself (the orchestration class, as opposed to the pure math it calls) has no dedicated
unit tests — it's mostly Prisma I/O and RPC calls in sequence, and testing that
meaningfully needs either a live database (not available in every environment this gets
built in) or mocking Prisma deeply enough that the test would mostly verify the mock. The
`market.e2e-spec.ts` API tests exercise the same tables this class writes to, which is
where the higher-value coverage is for now.
