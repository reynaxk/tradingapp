# Testing

## What exists in Phase 0

| Package/app | Runner | What's covered |
| --- | --- | --- |
| `packages/domain` | Vitest | Zod schema round-trips; `parseEnv`'s error formatting. |
| `packages/chain-adapters` | Vitest | `EvmChainDataProvider` degrades to `null`/`false` instead of throwing when its RPC is unreachable. |
| `apps/web` | Vitest | The env-parsing pattern (nothing else is business logic yet). |
| `apps/api` | Jest (unit) | Env schema validation; the global exception filter's production-vs-development behavior. |
| `apps/api` | Jest (e2e) | `GET /health` against a **live** Postgres and Redis — see below. |
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

## Migration verification

There's no live database in every environment this project gets built in, so migration
correctness isn't "trust me" — CI applies the actual migration SQL to a real, disposable
Postgres+Timescale service container on every run (`prisma migrate deploy`, see
`.github/workflows/ci.yml`) before running the e2e suite against it. If a migration is
broken, CI fails there, not later.

## What's deliberately not tested yet

No trading, wallet-signing, or social-feature tests exist because those features don't
exist yet (see the roadmap in the architecture spec). Adding tests ahead of the feature
they cover is its own kind of premature complexity.
