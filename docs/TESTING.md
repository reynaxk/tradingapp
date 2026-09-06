# Testing

## What exists as of Phase 3

| Package/app | Runner | What's covered |
| --- | --- | --- |
| `packages/domain` | Vitest | Zod schema round-trips; `parseEnv`'s error formatting; the Discovery Score formula and staleness gate (`market.test.ts`); EVM address validation/normalization (`wallet.test.ts`); activity-cursor encode/decode (including malformed input) and the Trending Score's gates/ordering (`social.test.ts`); EIP-4361 message construction (`wallet-auth.test.ts`); exact bps fee/min-output math, slippage-bounds validation, price-impact classification, and quote-expiry (`trading.test.ts`). |
| `packages/chain-adapters` | Vitest (unit) | `EvmChainDataProvider` and `uniswap-v3-math.ts`'s price/liquidity/market-cap math — the latter checked against real numbers observed on a live pool, not synthetic fixtures. `verifyEvmSignature` (`signature.test.ts`) against **real** ECDSA signatures from a well-known test keypair — valid/tampered/wrong-address/malformed all covered, never mocked crypto. |
| `packages/chain-adapters` | Vitest (**live** integration) | `UniswapV3PoolReader` against the real Base mainnet RPC and a real, live Uniswap V3 pool, including that a failed `eth_getLogs` call returns `null` (never a fabricated `[]`) and that `sender`/`recipient` decode correctly for trader identity — see below. |
| `apps/workers` | Vitest | Env schema validation; `MarketIngestionService#ingestSwaps` (mocked Prisma + mocked `UniswapV3PoolReader`) — cursor-advancement safety on an RPC failure vs. a genuine empty result, wallet upsert ordering (before the swap that references it), trader-vs-sender attribution, the realtime Redis ping (and that its failure doesn't fail the tick), and the 24h rollup decay/null-vs-zero rules including the Phase 2 activity stats. `TradeSweepService` (`sweep.test.ts`) — confirmed/failed/left-pending/expired transitions, chain-id scoping, and that one bad row's RPC error never aborts the rest of the batch. |
| `apps/api` | Jest (unit) | Env schema validation (including `JWT_SECRET` and Phase 3's chain/aggregator/fee vars); the global exception filter's production-vs-development behavior; `IdentityService` token issuance/verification. `WalletService` — challenge issuance, verification with real signatures (valid/wrong-account/tampered), single-use nonce consumption (including the concurrent-double-verify race), expiry, and cross-session rejection. `SafetyService`/`QuoteService`/`TransactionService`/`ZeroExSwapRouter` — wallet-ownership gating, input validation, honest quote-unavailable handling, the provider-slippage-floor sanity check, fee sourcing (server config only, never the request), submission idempotency on both `quoteId` and `(chainId, txHash)`, and status refresh driven only by a real receipt. |
| `apps/api` | Jest (e2e) | `GET /health`, the full `/market`, `/social` + `/identity`, and `/trade` route families — session issuance, activity pagination, trader profiles/404s, follow/like idempotency, wallet challenge/verify/list/unlink with real signatures (including replay protection, cross-user rejection, and challenge rate-limiting), quote/transaction authorization boundaries, an honest 422 in place of a fabricated quote, transaction idempotency, and trade-history scoping (including the global `ValidationPipe` rejecting an unrecognized `?userId=` outright) — all against a **live** Postgres and Redis. See below. |
| `apps/web` | Vitest | `lib/env.ts`'s validation (server, client, and Phase 3's chain/WalletConnect vars); `lib/format.ts`'s formatting; `lib/session-client.ts` (token persistence, error-message parsing preferring the API's own message); `lib/wallet-client.ts`/`lib/trading-client.ts` (request shape, 404-as-null for transaction lookups); component tests for `ActivityCard`, `FollowButton`, `ActivityFeed`, `ActivityFeedTabs`, `ConnectWalletButton` (mocked wagmi — connect/disconnect/wrong-network/switch-chain), `SlippageControl` (bounds enforcement), and `QuoteSummary` (renders exactly what's in the quote, including price-impact/approval warnings, never a "safe" claim). |
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
Phase 2's, and Phase 3's) to a real, disposable Postgres+Timescale service container on
every run (`prisma migrate deploy`, see `.github/workflows/ci.yml`) before running the e2e
suite against it. If a migration is broken, CI fails there, not later. Phase 1's migration
also converts `candles` into a real Timescale hypertable (`create_hypertable`) as part of
that same file — see `packages/db/prisma/migrations/20260904130000_market_data/migration.sql`.
Phase 2's migration (`20260906120000_social_layer`) is plain tables/columns, no hypertable
work — every new/altered column is nullable, so it applies cleanly against a database that
already has Phase 1 data in it. Phase 3's migration (`20260906180000_wallet_trading`) drops
`users.wallet_address` (always `null` in every real Phase 2 deployment — see
`docs/SOURCE_OF_TRUTH.md`) and adds the wallet-ownership/trading tables; every new column on
an existing table is nullable, so it too applies cleanly on top of live Phase 1/2 data.
**Not re-verified locally against a real database in this build's sandbox** — no Docker was
available to run `docker compose up -d`, no Redis was reachable, and the one native
Postgres install present had credentials this session didn't know. Migration correctness
for Phase 3 rests on the same CI step described above, not on a local run — flagged
honestly here rather than claimed as verified.

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

## What Phase 3 caught during development

- `apps/api` never had `@fomo/chain-adapters` as a declared dependency — Phase 1/2 only
  used it from `apps/workers`. `WalletService` (signature verification) and
  `TransactionService` (receipt reads) both need it directly; `pnpm typecheck` failed with
  `Cannot find module '@fomo/chain-adapters'` immediately, before either service was ever
  exercised at runtime.
- A quote/transaction-fixture test private key one character short of 64 hex chars
  (`invalid private key, expected hex or 32 bytes, got string`) — the same class of mistake
  `docs/TESTING.md` already recorded for hand-typed EVM *addresses* in Phase 2, this time in
  a hand-typed *private key*. Replaced with `generatePrivateKey()` rather than another
  hand-typed literal, so this specific mistake can't recur in this file.
- The same malformed-hex-length mistake showed up a third time, in a `PLATFORM_FEE_RECIPIENT_ADDRESS`
  test fixture reused verbatim from an existing repo-wide test address that happened to be
  38, not 40, hex characters everywhere else it appears (those other call sites never
  validate address *length* strictly, so it went unnoticed there) — caught only here because
  `PLATFORM_FEE_RECIPIENT_ADDRESS` is the first field in this codebase with a real regex
  requiring exactly 40 hex characters. Fixed in both `env.spec.ts` and `ci.yml`, without
  touching the other, non-length-sensitive call sites.
- Adding `quoteAddress`/`quoteDecimals` to `MarketSummary` and `SocialActivity.token`
  (needed so the trading UI can request a quote without a second round-trip) is additive at
  the schema level, but three existing `apps/web` component test fixtures constructed those
  shapes as full object literals and failed to typecheck once the new required fields
  existed — a reminder that "additive" at the database layer still means "find every
  hand-written fixture" at the type layer.
- `wagmi/connectors`' barrel file unconditionally re-exports a `coinbaseWallet`/`baseAccount`
  connector that pulls in `@coinbase/cdp-sdk`'s optional payments code, which statically
  imports `@x402/*` packages this app never installs. Not calling `coinbaseWallet()` doesn't
  help — ES module imports are resolved for the whole file graph before tree-shaking runs —
  so `next build` failed with `Module not found` even though the connector was never
  constructed. Fixed with a targeted `webpack.IgnorePlugin` in `next.config.mjs`; caught only
  by actually running `next build`, not by lint or typecheck (both passed cleanly first).
- A `quote.service.spec.ts` assertion compared `expiresAt - createdAt` for exact equality
  against `quoteTtlSeconds * 1000`, but the two timestamps come from separate `Date.now()`
  calls a few lines apart in the mocked test setup — an occasional 1ms real-clock drift
  failed the test nondeterministically. Fixed with a small tolerance instead of exact
  equality.

## What's deliberately not tested yet

Within Phase 2: comments, reposts, and bookmarks have no tests because they aren't
implemented (see `docs/SOCIAL.md`'s known limitations); the notification module remains
the empty boundary it was in Phase 0/1. `MarketIngestionService`'s Redis publish path is
tested for "doesn't fail the tick," not for the Redis client's own reconnect behavior —
that's `ioredis`'s contract, not this codebase's, same reasoning Phase 0 applied to the
health-check Redis client. Adding tests ahead of the feature they cover is its own kind of
premature complexity.

Within Phase 3 (see `docs/TRADING.md#known-limitations` for the full list): no test
exercises a real WalletConnect mobile-pairing session (the connector is wired but requires
an external project id this environment doesn't have); no test verifies an ERC-1271
smart-contract wallet signature (the adapter deliberately doesn't support one yet, and
correctly 401s rather than silently mis-verifying); and — most importantly — **no test in
this repository ever broadcasts a real, funded transaction**. Every signature in
`packages/chain-adapters`/`apps/api` tests is real ECDSA over a fresh, never-funded keypair;
every quote/transaction test against the real 0x endpoint (the e2e suite, in CI) relies on
CI's placeholder API key correctly failing upstream, which this codebase turns into an
honest `422` rather than treating as a crash.
