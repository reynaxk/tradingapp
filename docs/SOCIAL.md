# Phase 2: social architecture

Phase 1 made Fomo a market-data product. Phase 2 makes it a *social* one — real trading
activity, trader identity, and follows, on top of the same indexed data, without touching
Phase 1's ingestion model, chain adapter, or API structure. See `docs/SOURCE_OF_TRUTH.md`
first if you haven't; everything below follows the same rule (one authoritative owner per
fact, nothing fabricated, null over a guess).

```text
Blockchain
    ↓
Phase 1 Indexer (apps/workers/src/market/ingestion.ts)
    ↓
Swap / Market Data (packages/db — swaps, token_markets)
    ↓
Social Activity Domain (packages/domain/src/social.ts, wallet.ts)
    ↓
PostgreSQL (+ wallets/users/follows/activity_likes — this migration)
    ↓
API (apps/api/src/identity, apps/api/src/social)
    ↓
Redis (pub/sub ping only — no activity data lives in Redis)  /  Realtime (SSE)
    ↓
Fomo Web (apps/web)
```

## Activity model

An "activity" item is **not a new table** — it's a read-time projection of a `Swap` row
(see the comment on `Swap` in `schema.prisma`). Duplicating swaps into a parallel
`activities` table would create a second source of truth for the same fact, which
`docs/SOURCE_OF_TRUTH.md` rules out. Concretely:

```text
Raw blockchain event (Uniswap V3 Swap log)
        ↓
Normalized swap (apps/workers/src/market/ingestion.ts → `swaps` row)
        ↓
Social activity representation (apps/api/src/social/social.mapper.ts#toSocialActivity)
        ↓
API (GET /social/activity, /social/traders/:address/activity, ...)
        ↓
Feed UI (ActivityFeed / ActivityCard)
```

An activity item's `id` **is** the underlying `Swap.id` — stable, and exactly as
deduplicated as the swap it represents (`@@unique([chainId, txHash, logIndex])` on `Swap`
already prevents a duplicate event from ever producing a duplicate row, so there is no
separate duplicate-activity problem to solve). Likes (`ActivityLike.swapId`) point at the
same id for the same reason — engagement layers on top of the authoritative row rather than
a copy of it.

## Trader identity

`Wallet` (`packages/db/prisma/schema.prisma`) is the trader-identity table — an address
with observed public trading activity, independent of whether anyone has ever signed up.
See `docs/WALLET_SECURITY.md`'s wallet-first identity model; this is that model, built.

```text
Wallet (address, displayName?, avatarUrl?, firstSeenAt)
   ↓
Trader profile (GET /social/traders/:address — stats computed from `swaps`)
   ↓
Optional authenticated User account (Wallet.userId, set only after cryptographic
verification — see docs/TRADING.md#wallet-ownership)
```

Rows are created **lazily by the ingestion worker**, never by a user action — following an
address that has never traded 404s (`FollowService#follow`) rather than creating a phantom
profile with no real data behind it. `firstSeenAt` is the block timestamp of that wallet's
first indexed swap, not "first followed" or "first requested."

**Trader attribution heuristic.** A Uniswap V3 `Swap` event carries two addresses:
`sender` (whichever address called the pool's `swap()` — almost always a router contract)
and `recipient` (the address that received the output tokens). `Swap.traderAddress` is
populated from `recipient`: for a direct, single-hop swap this is the end user's own
wallet; for a multi-hop route it can be an intermediate router/pool contract instead of the
ultimate trader. This is a disclosed, deliberate heuristic, not perfect attribution — see
"Known limitations" below. `sender` is captured too (`Swap.senderAddress`) for audit and
future refinement, but never used as trader identity.

Both columns are nullable: swaps indexed before this migration predate wallet capture and
stay `null` forever (no backfill — we can't honestly re-derive who traded without
re-fetching those exact logs). Every swap indexed from this migration onward has both set.

### Trader stats

`TraderService#getProfile` / `getStats` compute only what's correctly derivable from
indexed `swaps`: total swap count, buy/sell counts, total volume, first-seen and
last-active timestamps. **Deliberately absent: profit, ROI, win rate, portfolio value,
PnL.** Fomo does not track cost basis (the price at which a trader's current holdings were
acquired), so any of those numbers would be fabricated. This is the same non-fabrication
principle Phase 1 applies to `priceChange24hPct`/`volume24hUsd` (null, not a guess, until
the data genuinely supports it) — see `docs/SOURCE_OF_TRUTH.md`.

### Trader discovery

`TraderService#getTopTraders` ("Top Traders" in the UI) ranks wallets by real, measured 24h trading volume
(`SUM(volume_usd)` over `swaps`, grouped by `trader_address`), gated by a minimum trade
count (`MIN_TRADES_FOR_TOP_TRADERS = 2`) so a single large trade can't win "most active."
Labeled **"Most Active" / "Highest Volume,"** never "smart money" or "profitable trader" —
those claims would require the cost-basis data this system doesn't have.

## Follow system

`Follow` (`userId`, `walletAddress`) is a plain join table: a `User` following a `Wallet`'s
public activity. `@@unique([userId, walletAddress])` enforces "no duplicate follows" at the
database level; `FollowService#follow` treats a duplicate `create()` (Prisma error code
`P2002`) as an idempotent success rather than an error, since a double-click or a retried
request can legitimately fire the same follow twice. `@@index([walletAddress])` backs
follower counts/lists without a table scan.

Following a wallet that has never traded (no `Wallet` row exists yet) returns **404**, not
a phantom follow target — see Trader identity above.

## Authentication

**This is not the login `docs/WALLET_SECURITY.md` describes** (email/passkey via a managed
provider, or Sign-In With Ethereum). Building real SIWE signature verification or
outsourcing to an auth provider is real, separately-scoped work; Phase 2 ships the minimum
that makes follows/likes real and attributable without it:

```http
POST /identity/session   →  { token, userId }
```

creates a brand-new, anonymous `User` row and signs a JWT naming it. **No wallet-ownership
claim is made or requested** — this is the load-bearing distinction from "wallet login."
Section 23's "never trust client-provided wallet ownership" is satisfied by never asking
for one at all, not by verifying one badly. The web client calls this endpoint lazily, on
the *first* follow/like a viewer attempts (`apps/web/lib/social-client.ts#ensureSessionToken`),
stores the token in `localStorage`, and attaches it as `Authorization: Bearer <token>` on
every mutation. Viewing feeds, profiles, and tokens never requires a session.

`JwtAuthGuard` (required — 401 without a valid token) and `OptionalAuthGuard` (attaches a
session if present, never rejects) are the only two auth surfaces. `IdentityService#verifyToken`
re-checks that the named user still exists on every call rather than trusting the JWT's
claim alone — the token proves "the server issued this," not "this user account is still
meaningful," and those are deliberately checked separately.

**A server-rendered page can never see a browser's session** (it lives in `localStorage`,
never a cookie), so `isFollowedByMe`/`likedByMe` from a Server Component fetch are `null`
on first paint by construction. `FollowButton` resolves the real state client-side after
mount (`checkFollowStatus`), using whatever session the browser already has — never
creating a new one just to check.

**Built in Phase 3:** real SIWE-style wallet verification now populates `Wallet.userId` —
see docs/TRADING.md#wallet-ownership for the challenge/signature flow. Every account Phase
2 itself creates still starts with no verified wallet, and `TraderProfile.followingCount`
(wallets a trader's linked account follows) is 0 until that account both verifies a wallet
and follows someone.

## Pagination

Every feed (`GET /social/activity`, `.../following`, `.../traders/:address/activity`) uses
**keyset (cursor) pagination**, never offset: `ORDER BY block_timestamp DESC, id DESC`,
with `swaps`' `@@index([blockTimestamp, id])` (global) and `@@index([traderAddress,
blockTimestamp])` (per-trader/following) backing the scan. A cursor is opaque —
base64url of `{ blockTimestamp, id }` (`packages/domain/src/social.ts#encodeActivityCursor`)
— and the tie-breaking `id` matters: relying on `blockTimestamp` alone would silently drop
or duplicate rows across a page boundary whenever two swaps share a timestamp (routine at
this granularity). A client-supplied cursor is **untrusted input** — `decodeActivityCursor`
returns `null` for anything malformed, and every feed treats a `null` cursor as "start from
the newest," never a 400. See Security below.

## Trending

`computeTrendingScore` (`packages/domain/src/social.ts`) ranks tracked markets by real
trading *activity*, not raw volume:

```text
score = 0.35·log10(1 + volume24hUsd)
      + 0.40·log10(1 + uniqueTraders24h)
      + 0.25·log10(1 + tradeCount24h)
```

Log-scaling keeps one whale trade or one hyperactive bot from mathematically dominating —
same rationale as `DISCOVERY_RANKING` in `market.ts`. A market must clear **every** minimum
before it's scored at all (excluded, not scored low):

- `liquidityUsd ≥ DISCOVERY_RANKING.minLiquidityUsd` ($10,000 — same floor as Phase 1's
  discovery gate)
- `volume24hUsd ≥ $1,000`
- `uniqueTraders24h ≥ 3`
- `tradeCount24h ≥ 5`

The unique-trader and trade-count floors are the actual anti-illiquidity protection: a
single wallet trading the same thin pool a dozen times cannot manufacture "trending" by
volume alone. `uniqueTraders24h`/`tradeCount24h` are cached on `TokenMarket`, refreshed
every ingestion tick by `MarketIngestionService#recomputeRollups` from `COUNT(*)` /
`COUNT(DISTINCT trader_address)` over `swaps` — same null-until-ever-traded, 0-not-stale
decay rule already established for `volume24hUsd` in `docs/MARKET_DATA.md`. This keeps
`TrendingService#getTrending` a cheap application-layer sort over already-computed fields,
exactly like `MarketService#discover`.

Deliberately distinct from `DISCOVERY_RANKING` (Phase 1's `/market/discover` formula):
discovery answers "what has real volume/momentum/liquidity," trending answers "what is a
*growing number of people* actually trading right now." Conflating them would have erased
the ability for a token with rapidly broadening participation to surface ahead of one
whale-dominated market with bigger raw numbers — the literal case Phase 2 was asked to make
possible.

## Realtime

```text
Ingestion worker (new swaps persisted)
   ↓
Redis PUBLISH fomo:activity:new  { tokenMarketId, count, atIso }   (ACTIVITY_REALTIME_CHANNEL)
   ↓
API: RealtimeService (dedicated `redis.duplicate()` subscriber, one per process)
   ↓
SSE: GET /social/activity/stream  (one RxJS Subject fanned out to every connected client)
   ↓
Browser: EventSource → "N new" pill → click refetches via the normal paginated endpoint
```

The published message is a **bare ping**, never the activity payload itself — the worker
doesn't know or need to know the API's response shape, and a client that misses a message
(a brief disconnect, a missed heartbeat) just catches up on its next successful fetch. This
also means a Redis outage degrades to "the feed stops feeling instantly live" — ingestion
and the paginated REST endpoints are entirely unaffected (`publishNewActivity` in
`ingestion.ts` catches and logs a publish failure; it never fails the ingestion tick).

New activity **never auto-inserts** above whatever the viewer is currently reading — it
surfaces as a small "● N new trades" pill (`ActivityFeed`), revealed only on click, so nothing
disrupts an in-progress scroll or read. The SSE connection includes a 20-second heartbeat
event specifically so a client can distinguish "quietly live" from "actually disconnected"
(idle SSE connections are silently dropped by some proxies/load balancers) — see Error
states below.

**The one deliberate exception to "the browser never talks to the API directly."** Every
other read in this app goes through a Server Component (`lib/market-api.ts`,
`lib/social-api.ts`, server-only `API_BASE_URL`). SSE and follow/like mutations structurally
require a real browser-to-API connection, so `apps/web/lib/social-client.ts` is the one
module that calls the API directly from the browser, via a new, deliberately public
`NEXT_PUBLIC_API_BASE_URL`. Nothing else in the app uses it.

## Personalized feed

`GET /social/activity` (global, gated by Phase 1's liquidity floor, optionally scoped to one
token via `?tokenAddress=`) and `GET /social/activity/following` (requires a session; empty
— not an error — for a user following no one) share the same underlying keyset-pagination
machinery (`ActivityService#fetchPage`). On the web, `ActivityFeedTabs` renders both as a
"For you" / "Following" tab pair: "For you" is server-rendered like everything else;
"Following" fetches client-side on first switch (a Server Component can't see the browser's
session — see Authentication), and shows an honest "you're not following anyone yet" state
for a visitor with no session at all, rather than silently minting one just because they
clicked the tab.

## Social signals

`ActivityLike` (`userId`, `swapId`, likes) is the full extent of Phase 2's engagement surface —
comments, reposts, and bookmarks are explicitly deferred (see "Deferred to later phases").
Same idempotent-on-duplicate pattern as `Follow` (`@@unique([userId, swapId])` + graceful
`P2002` handling). Like counts and "did I like this" are **batched per feed page** —
`ActivityService#batchLikeState` issues one `groupBy` (counts) and one `findMany`
("liked by me" set) for the whole page, never a per-item query — so a 20-item feed page is
always 2 extra queries, not 40.

## Search

`GET /social/traders/search?q=&limit=` (`TraderService#search`) extends Phase 1's
token/pair search to traders — server-backed and indexed, never a client-side scan of
loaded data. It matches on an address prefix/substring or `displayName` (case-insensitive),
returning the same minimal `{ address, displayName, avatarUrl }` shape as follow/following
lists — no stats, so a page of search results is one bounded query, not N. On the web, the
Discover page's existing search form (`SearchBar`, unchanged) now also renders a "Traders"
section alongside token results when a query matches at least one tracked trader.

## API

All under `/v1` (existing global prefix). Every response is a normalized domain object
(`social.mapper.ts`) — never a raw Prisma row.

| Endpoint | Notes |
| --- | --- |
| `GET /identity/session` → `POST` | Issues an anonymous session. Throttled to 10/min/IP. |
| `GET /social/activity` | `?cursor=&limit=1-50&tokenAddress=`. `OptionalAuthGuard`. |
| `GET /social/activity/following` | Requires a session. |
| `GET /social/activity/stream` | SSE. Public — a ping carries no user data. |
| `POST` / `DELETE /social/activity/:id/like` | Requires a session. 404 for an unknown activity id. Throttled to 20/min. |
| `GET /social/trending` | `?limit=1-50`. |
| `GET /social/traders/top` | `?limit=1-25`. Registered before `traders/:address` — see routing note below. |
| `GET /social/traders/search` | `?q=&limit=1-25`. Registered before `traders/:address`. |
| `GET /social/traders/:address` | 404 for an address that has never traded, 400 for a malformed address. `OptionalAuthGuard`. |
| `GET /social/traders/:address/activity` | Same pagination as the global feed. |
| `GET /social/traders/:address/followers` | Cursor-paginated; items are minimal (`userId`, `followedAt`) — see Authentication for why. |
| `GET /social/traders/:address/following` | Cursor-paginated; almost always empty until wallet-linking exists. |
| `POST` / `DELETE /social/traders/:address/follow` | Requires a session. 404 if the wallet has never traded. Throttled to 20/min. |

**Routing note:** `traders/search` and `traders/top` are literal two-segment routes that
would otherwise collide with `traders/:address` (also two segments) — NestJS/Express match
routes in declaration order, so both are registered before the param route in
`social.controller.ts`. A regression here would silently turn `GET /social/traders/search`
into "look up the trader literally named 'search'," so if you add another literal
`traders/<word>` route, put it above `traders/:address` too.

## Security

- **No private keys, no wallet custody, no server-side signing** — unchanged from Phase 0/1;
  nothing in Phase 2 touches a wallet's funds or requires it to.
- **Every address is validated before it reaches a service**: `AddressParamDto` /
  `ActivityQueryDto.tokenAddress` (`class-validator` `@Matches`) reject a malformed EVM
  address with 400 before any database call.
- **Every cursor is validated defensively, not trusted**: `decodeActivityCursor` returns
  `null` for anything malformed rather than throwing — see Pagination.
- **Mutations are authenticated and scoped to the caller** — `FollowService`/`LikeService`
  always operate on `req.user.id` from a verified JWT, never a client-supplied user id.
  There is no endpoint that accepts a `userId` in a request body.
- **Duplicate mutations are idempotent, not erroring** — a double-submitted follow/like
  never produces two rows (DB unique constraint) and never surfaces as a 409/500 to a client
  that fired the same request twice.
- **Mutation endpoints are rate-limited** beyond the app-wide default
  (`@nestjs/throttler`): session issuance (10/min/IP), follow/unfollow and like/unlike
  (20/min). This is IP-based throttling, not a full bot/abuse detection system — see Known
  limitations.
- **Structured logs never carry a session token** — `nestjs-pino`'s existing
  `redact` config (`app.module.ts`) already covers the `authorization` header; nothing in
  Phase 2 logs a raw JWT or session id.

## Error states

Covers loading, empty, error, and stale/reconnecting states.

- **Loading**: `ActivityFeedTabs`'s Following tab and `FollowButton`'s pending state use
  `Skeleton` placeholders, matching Phase 1's existing loading convention (never a blank
  screen or a layout jump).
- **Empty**: "No recent activity yet." (global/token/trader feeds with genuinely nothing
  indexed) and "You're not following anyone yet." (following feed, or an unauthenticated
  visitor on that tab) are real, distinct messages — never a generic "no results."
- **Error**: a failed follow/like rolls back its optimistic UI change and shows a plain
  retry-worthy message (`FollowButton`); a failed feed fetch (load-more or reveal-new) just
  leaves the affected control available to retry, rather than failing silently or crashing
  the page.
- **Stale/reconnecting**: the SSE connection's state is always visible
  (`ActivityFeed`'s "Connecting…" / "Live" / "Live updates paused — reconnecting…"
  indicator) — the feed never claims to be live when the connection has actually dropped.

## Performance / growth-readiness

- Every feed query is cursor-paginated and bounded (`take: limit + 1`, `limit ≤ 50`) — no
  endpoint returns an unbounded result set.
- Every feed query is backed by a real index: `swaps(block_timestamp, id)` (global),
  `swaps(trader_address, block_timestamp)` (per-trader/following), `follows(wallet_address)`
  (follower lookups/counts), `activity_likes(swap_id)` (batched like counts).
- Like/follow state for a feed page is always 2 extra queries total, never per-item — see
  Social signals above.
- The realtime layer is one Redis connection per API process (not per connected browser)
  fanning out through an in-process RxJS `Subject` — see Realtime above.
- `TrendingService`/`MarketService#discover` both sort in application code over one bounded
  fetch — the same documented, honest tradeoff Phase 1 already made and disclosed at this
  tracked-market count; the upgrade path (a SQL-computed/materialized view) is the same one
  Phase 1 already named, not a new deferral.

## Known limitations (Phase 2, as shipped)

- **Trader attribution is a heuristic, not ground truth.** `recipient` is usually the real
  trader for a direct swap, but can be a router/intermediate contract for a multi-hop
  route. Disclosed above under Trader identity; refining this would mean recognizing known
  router addresses and falling back to a different heuristic, deferred.
- **Pre-Phase-2 swaps have no trader.** `traderAddress`/`senderAddress` are `null` for
  every swap indexed before this migration — never backfilled with a guess. A wallet's
  "first seen trading" and stats only reflect swaps indexed from here forward.
- **No verified wallet ownership.** Phase 2's session proves nothing about which wallet a
  person controls — see Authentication. Anyone can create an anonymous session and follow
  any tracked trader; nothing here lets them claim *to be* one.
- **Followers/following lists have minimal item data.** A follower is just `{userId,
  followedAt}` — Phase 2's anonymous sessions have no display identity to show. This
  self-resolves once real wallet-linking exists.
- **Anti-spam is IP-based rate limiting only** — no CAPTCHA, no proof-of-work, no bot
  detection. Sufficient to stop naive scripted abuse, not a determined attacker.
- **No comments, reposts, or bookmarks.** The schema doesn't foreclose them (an activity
  item's stable id — the underlying `Swap.id` — is exactly what a future `Comment`/`Repost`
  table would key off of, the same way `ActivityLike` does today), but none are implemented.
- **No notification delivery.** `apps/api/src/notifications` remains the empty module
  boundary it was in Phase 0/1. A follow or like is a fact anyone could derive a
  notification from later; nothing computes or stores one yet.
- **"Top Traders" and "Trending" are computed at request time** over the full tracked-market
  /24h-swap set — fine at Phase 1/2's bounded scale, the documented next step (a
  materialized/SQL-computed view) is the same one already named for `/market/discover`.

## Deferred to later phases

Verified wallet linking (real SIWE — the login `docs/WALLET_SECURITY.md` actually
describes), email/passkey login, comments, reposts/shares, bookmarks, a real notification
center, moderation/spam detection beyond rate limiting, router-address-aware trader
attribution, and materialized trending/top-trader views once tracked-market or swap volume
stops being small.
