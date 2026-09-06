# Testing

## What exists as of Phase 2

| Package/app | Runner | What's covered |
| --- | --- | --- |
| `packages/domain` | Vitest | Zod schema round-trips; `parseEnv`'s error formatting; the Discovery Score formula and staleness gate (`market.test.ts`); EVM address validation/normalization (`wallet.test.ts`); activity-cursor encode/decode (including malformed input) and the Trending Score's gates/ordering (`social.test.ts`). |
| `packages/chain-adapters` | Vitest (unit) | `EvmChainDataProvider` and `uniswap-v3-math.ts`'s price/liquidity/market-cap math — the latter checked against real numbers observed on a live pool, not synthetic fixtures. |
| `packages/chain-adapters` | Vitest (**live** integration) | `UniswapV3PoolReader` against the real Base mainnet RPC and a real, live Uniswap V3 pool, including that a failed `eth_getLogs` call returns `null` (never a fabricated `[]`) and that `sender`/`recipient` decode correctly for trader identity — see below. |
| `apps/workers` | Vitest | Env schema validation; `MarketIngestionService#ingestSwaps` (mocked Prisma + mocked `UniswapV3PoolReader`) — cursor-advancement safety on an RPC failure vs. a genuine empty result, wallet upsert ordering (before the swap that references it), trader-vs-sender attribution, the realtime Redis ping (and that its failure doesn't fail the tick), and the 24h rollup decay/null-vs-zero rules including the two new Phase 2 activity stats. |
| `apps/api` | Jest (unit) | Env schema validation (including `JWT_SECRET`); the global exception filter's production-vs-development behavior; `IdentityService` token issuance/verification (a token signed with a different secret, a structurally invalid token, an expired token, and a token naming a user that no longer exists are all rejected). |
| `apps/api` | Jest (e2e) | `GET /health`, the full `/market` route family, and the full `/social` + `/identity` route family — session issuance, activity pagination (including a malformed cursor never 400ing), trader profiles/404s, follow/unfollow idempotency and cross-session isolation, like/unlike idempotency, the following feed, trending, and search — all against a **live** Postgres and Redis. See below. |
| `apps/web` | Vitest | `lib/env.ts`'s validation (both the server and the new client env schema); `lib/format.ts`'s formatting, including `formatRelativeTime` and the locale bug this caught (see below); component tests (`@testing-library/react` + jsdom, new in Phase 2) for `ActivityCard`, `FollowButton` (including optimistic rollback and the client-side follow-state resolution a Server Component can't do itself), `ActivityFeed` (loading/empty states, live-status transitions, the new-activity reveal/dedupe flow, load-more pagination), and `ActivityFeedTabs` (the Following tab's no-session/loading/loaded/error states). |
| `packages/db` | — | No unit tests; correctness is verified by CI actually applying every migration (see below), not by mocking Prisma. |

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
correctness isn't "trust me" — CI applies the actual migration SQL (Phase 0's, Phase 1's,
and Phase 2's) to a real, disposable Postgres+Timescale service container on every run
(`prisma migrate deploy`, see `.github/workflows/ci.yml`) before running the e2e suite
against it. If a migration is broken, CI fails there, not later. Phase 1's migration also
converts `candles` into a real Timescale hypertable (`create_hypertable`) as part of that
same file — see `packages/db/prisma/migrations/20260904130000_market_data/migration.sql`.
Phase 2's migration (`20260906120000_social_layer`) is plain tables/columns, no hypertable
work — every new/altered column is nullable, so it applies cleanly against a database that
already has Phase 1 data in it, not just a fresh one.

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

## What Phase 2 caught during development

- `@nestjs/jwt@12` (the latest at the time) ships an ESM build; Jest's default CJS
  transform couldn't load it (`Cannot use import statement outside a module`). Pinned to
  `^10.2.0`, the release aligned with this project's Nest v10 — caught immediately by
  `pnpm --filter @fomo/api test` failing to even parse, not a runtime surprise.
- `ActivityFeed` was first written taking a `fetchPage` function as a prop, set by the
  Server Component page that renders it. Server Components cannot pass a function to a
  Client Component — React strips it at the RSC boundary. Caught before it shipped by
  re-checking the design against React's actual constraints, not by a failing test (no
  test would have caught this short of an actual `next build`/render, which does pass); a
  serializable `scope` discriminator (`{ type: 'global' | 'token' | 'trader' | 'following',
  address? }`) replaced it, with the component choosing the right `lib/social-client.ts`
  fetcher internally.
- A Server Component page render can never see the browser's session (it lives in
  `localStorage`, never a cookie), so `TraderProfile.isFollowedByMe` from a server-rendered
  fetch is `null` on every real page load, not just for a genuinely unauthenticated visitor.
  `FollowButton` originally trusted that prop outright, which meant it always rendered
  "Follow" even for someone already following. Fixed by having the button resolve the real
  state client-side after mount (`checkFollowStatus`), using whatever session the browser
  already has, without creating a new one just to check.
- The "Following" feed's API endpoint and the `ActivityFeed` component's support for it
  both existed before any page actually rendered a way to reach it — "return to a
  personalized feed" (one of Phase 2's own success criteria) wasn't reachable from the UI
  at all. Caught by re-reading the success criteria against what was actually wired into
  `apps/web/app/page.tsx`, not by a test (nothing was broken — a real feature was simply
  unused).
- `apps/web`'s `jsdom` devDependency, added unpinned, resolved to `^30.0.1`, which pulls in
  an `undici` version calling `webidl.util.markAsUncloneable` — an API not present in CI's
  Node 20 (it worked locally under a newer Node). Pinned to `jsdom@25.0.1`. Not caught
  locally, since nothing in this environment runs CI's exact Node version — a real gap in
  local verification for a devDependency version bump specifically, worth remembering.
- `social.e2e-spec.ts`'s trader address fixture was 38 hex characters, not 40 — the exact
  same mistake `819746b` fixed in `market.e2e-spec.ts` during Phase 1, this time in a fresh
  file. `AddressParamDto` correctly rejected it as malformed (400), which cascaded into
  eight failing assertions across follow, like, trending, and top-traders tests that all
  depend on that one address resolving. Caught only by CI (this sandbox has no live
  Postgres to run e2e locally) — worth generating fixture addresses programmatically
  (`'1'.repeat(40 - tail.length) + tail`) rather than hand-typing hex strings, given this is
  now a repeat mistake.
- `social.e2e-spec.ts` originally reused `market.e2e-spec.ts`'s exact chain/token/pool
  fixture addresses. Jest runs e2e spec *files* in parallel by default (no `maxWorkers`
  config), and both suites share one live database — the two `afterAll` hooks raced to
  delete the same `tokenMarket` row, and mid-test queries in one file intermittently saw
  rows the other file's `beforeAll`/`afterAll` was concurrently creating or deleting.
  Fixed at both levels: `social.e2e-spec.ts` now uses fixture addresses distinct from every
  other e2e spec, and `jest-e2e.json` sets `maxWorkers: 1` so e2e spec files never run
  concurrently against the shared database again, regardless of what future spec files add.
- Vitest's default esbuild JSX transform doesn't treat Next's `"jsx": "preserve"` tsconfig
  setting as the automatic runtime, so component tests failed immediately with `React is
  not defined`. Fixed with an explicit `esbuild: { jsx: 'automatic' }` in
  `apps/web/vitest.config.ts`. Similarly, `@testing-library/react`'s automatic
  `afterEach(cleanup)` only registers when it finds `afterEach` on `globalThis`, which
  requires Vitest's `globals: true` — this project imports test helpers explicitly instead
  (matching every other package), so tests leaked DOM state across cases (`getByRole`
  matching multiple buttons) until `vitest.setup.ts` called `cleanup()` explicitly.

## What's deliberately not tested yet

No wallet-signing or trading-execution tests exist because that surface doesn't exist yet
(see the roadmap in the architecture spec) — Phase 2 is deliberately social-only. Within
Phase 2 itself: comments, reposts, and bookmarks have no tests because they aren't
implemented (see `docs/SOCIAL.md`'s known limitations); the notification module remains
the empty boundary it was in Phase 0/1. `MarketIngestionService`'s Redis publish path is
tested for "doesn't fail the tick," not for the Redis client's own reconnect behavior —
that's `ioredis`'s contract, not this codebase's, same reasoning Phase 0 applied to the
health-check Redis client. Adding tests ahead of the feature they cover is its own kind of
premature complexity.
