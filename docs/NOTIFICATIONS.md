# Phase 4: notifications architecture

Phase 2 made Fomo social (follows, likes, a realtime activity feed). Phase 3 made it
tradeable. Phase 4 makes it *feel alive* — a real notification domain, backed by
PostgreSQL, delivered live over the same Redis+SSE plumbing Phase 2 already built. See
`docs/SOURCE_OF_TRUTH.md` first; everything below follows the same rule (one authoritative
owner per fact, nothing fabricated, null over a guess).

```text
Domain event (follow, like, indexed swap, trending transition)
    ↓
Notification created (PostgreSQL — the only source of truth, never Redis)
    ↓
Realtime ping published (Redis — fomo:notifications:new)
    ↓
SSE stream (apps/api/src/notifications, per-connection, filtered to one userId)
    ↓
Fomo Web (notification bell / center — refetches on ping, never trusts the ping's payload)
```

Persist, *then* publish — never the other way around. A Redis outage or a dropped SSE
connection can only ever delay a recipient finding out; it can never be the only copy of a
notification, and it can never prevent one from being created. See "Realtime delivery" and
"Failure degradation" below.

## Notification types

| Type | Trigger | Actor | Audience | Created by |
|---|---|---|---|---|
| `FOLLOW` | A follows B's wallet | User A | B (if B's wallet is linked to an account) | apps/api (`FollowService` → `NotificationService`) |
| `LIKE` | A likes B's trade | User A | B (the trade's trader, if linked) | apps/api (`LikeService` → `NotificationService`) |
| `FOLLOWED_TRADER_TRADE` | An indexed swap by trader T lands | Wallet T | T's followers | apps/workers (`NotificationFanoutService`) |
| `WHALE_TRADE` | An indexed swap ≥ `WHALE_TRADE_USD_THRESHOLD` lands | Wallet T | Users with a confirmed trade history in that token | apps/workers |
| `TRENDING_TOKEN` | A token's trending state flips false → true | — | Every user with the preference enabled | apps/workers |

Every recipient is resolved server-side from data the recipient already controls or is
already entitled to see (their own linked wallet, their own follow list, their own trade
history) — never from a client-supplied recipient id. See "Security" below.

## Why two creators, not one

Follows and likes are session actions apps/api already owns end-to-end — creating their
notifications inline, in the same request, is the natural place. `FOLLOWED_TRADER_TRADE`,
`WHALE_TRADE`, and `TRENDING_TOKEN` are different in kind: they must reflect **confirmed,
indexed activity**, never an optimistic client-submitted trade (`TradeTransaction` in
`PENDING` state) and never a reverted or never-broadcast transaction, which never produces a
`Swap` row at all. The indexer (`apps/workers`) is the only process that ever creates a
`Swap`, so it's the only process that can honestly know a trade happened — the same
authority split `docs/TRADING.md` already establishes between optimistic submission and
confirmed settlement.

This mirrors Phase 3's own precedent exactly: `TransactionService` (apps/api) and
`TradeSweepService` (apps/workers) are two independent orchestrators sharing pure logic from
`@fomo/domain`, each with its own thin Prisma-touching implementation. Notifications follow
the same shape — `NotificationService` (apps/api, for FOLLOW/LIKE) and
`NotificationFanoutService` (apps/workers, for the other three), both built on the same
dedupe-key/preference/deep-link helpers in `packages/domain/src/notifications.ts`.

## Idempotency

Every notification carries a `dedupeKey`, scoped within `(userId, type)` by
`@@unique([userId, type, dedupeKey])` on the `notifications` table. Every creation path
builds its key with the matching pure helper in `@fomo/domain/notifications`:

- `followDedupeKey(followerUserId)` — scoped to the follower alone, not the follow event.
  Unfollowing and re-following the same trader must never re-notify; there's exactly one
  "follows you" fact per (follower, followed) pair regardless of how many times it toggles.
- `likeDedupeKey(likerUserId, swapId)` — scoped to both, since one recipient can receive
  many like notifications (one per liked trade) from many different likers.
- `followedTraderTradeDedupeKey(swapId)` / `whaleTradeDedupeKey(swapId)` — scoped to the
  swap alone; a retried worker tick or a re-processed block range can never duplicate the
  notification for a real trade that already notified.
- `trendingTokenDedupeKey(tokenMarketId, transitionAtIso)` — scoped to one specific
  false→true transition (tracked in `TokenTrendingState.becameTrendingAt`), so a later
  re-entry into trending gets a new key and can notify again, while the same continuous
  trending streak never repeats.

A duplicate `create()` throws Prisma's `P2002` (unique constraint violation), caught and
treated as a silent no-op — the exact same pattern `FollowService`/`LikeService` already use
for duplicate follows/likes. Bulk fan-out (`NotificationFanoutService#bulkCreate`) uses
`createMany({ skipDuplicates: true })` for the same reason at scale. This is real database
uniqueness, not in-memory dedup — it survives worker restarts, concurrent ticks, and retried
API requests.

## Whale trades

`WHALE_TRADE_USD_THRESHOLD` (default `$25,000`, see `NOTIFICATION_DEFAULTS` in
`@fomo/domain/notifications`) is defined in exactly one place and consumed by
`apps/workers`' env schema (`WHALE_TRADE_USD_THRESHOLD`, overridable per environment) —
never hardcoded at more than one call site.

**Audience.** Recipients are users with a `CONFIRMED` `TradeTransaction` in the exact same
token — a real, existing interest signal from Phase 3's own trading data, not a broadcast to
the whole user base. Someone who has never traded a token doesn't get paged about a whale
trade in it.

**Bounded two ways** against a burst of large trades exploding into a wall of
notifications:
1. A per-token cooldown (`NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes`, default 15) —
   checked directly against the `notifications` table (`type = WHALE_TRADE`, scoped by
   `tokenMarketId`/`createdAt`), no separate state table needed.
2. At most one triggering swap per token within a single ingestion tick's own batch, even if
   several qualify in the same tick.

The whale trader themselves is always excluded from their own notification's audience.

## Trending tokens

Reuses `computeTrendingScore` from `packages/domain/src/social.ts` directly — **never** a
second trending algorithm. "Currently trending" is exactly `computeTrendingScore(...) !==
null`, the same definition `TrendingService`/`GET /social/trending` already use.

`TokenTrendingState` tracks one boolean (`isTrending`) and one timestamp
(`becameTrendingAt`) per token market — a rebuildable cache of trending *state*, not a
stored score, checked once per market per ingestion tick right after that market's own 24h
rollup recompute (the score depends on nothing else). A notification fires only on a
**false → true transition** — entering trending — never on every tick's score fluctuation,
and never on exiting.

Unlike whale trades, there's no narrower "prior interest" cohort for trending — it's a
discovery feature, meant to reach people not already engaged with a token, so every user
with the `trendingTokens` preference enabled is notified. Boundedness here comes from
*frequency* (one notification per continuous trending streak, system-wide, not per
fluctuation) rather than audience size. At a very large registered-user count this implies a
wide fan-out per genuine trending event — a known, disclosed tradeoff, not an oversight; see
"Deferred / known limitations" below.

## Preferences

Five independent toggles (`follows`, `likes`, `followedTraderTrades`, `whaleTrades`,
`trendingTokens`), all defaulting to enabled (`NOTIFICATION_DEFAULTS.preferenceDefaults`) —
an opt-out model, since a notification product that ships silent by default doesn't do its
job. No `NotificationPreference` row means every default applies; a row is created lazily on
first write (`upsert`), not eagerly for every signup, matching this schema's existing
"don't duplicate data unnecessarily" convention.

Preferences are checked **at creation time**, server-side, always read fresh from the
database — never trusted from client input, and never a security boundary (a disabled
preference stops a notification from being *created*; it grants no access to anything and
is irrelevant to authorization).

## Deep links

`notificationDeepLink(type, ctx)` in `@fomo/domain/notifications` — a pure function, so
apps/api and apps/web can never disagree on what a notification points to. Uses the app's
**real, existing routes**: `/trader/[address]` for `FOLLOW`, `/market/[address]` for
everything else (`LIKE`, `FOLLOWED_TRADER_TRADE`, `WHALE_TRADE`, `TRENDING_TOKEN`) —
deliberately not the illustrative `/traders/{address}`-shaped URLs an earlier draft of this
spec sketched, which don't match this app's actual routing. Returns `null`, never a
fabricated link, when there's nothing to point to (e.g. an actor with no linked wallet).

## Data model

`Notification` stores **references only** — `actorUserId` / `actorWalletAddress` / `swapId`
/ `tokenMarketId` — never a precomputed title, body, or deep-link string. Presentation is
derived at read time from whatever those references currently say, the same "read-time
projection" pattern `SocialActivity` already uses over `Swap`. This means a notification's
copy always reflects the *current* state of the entity it references (an updated
displayName, for instance) rather than a stale snapshot, and there's no second copy of any
fact to keep in sync.

`actorUserId` vs. `actorWalletAddress` — exactly one is populated, never both, depending on
what kind of fact the actor represents:
- `FOLLOW`/`LIKE`: the actor is a *session* action (a `User`), who may not even have a
  linked wallet yet. `actorUserId` is stored; the display wallet (if any) is resolved at
  read time as that user's earliest-verified linked wallet, via a single nested `include`
  (never a per-row follow-up query — see `notification.mapper.ts`).
- `FOLLOWED_TRADER_TRADE`/`WHALE_TRADE`: the actor is a *wallet-level* fact (the trader who
  made the swap) — `actorWalletAddress` is stored directly.
- `TRENDING_TOKEN`: no actor at all.

Indexes: `@@unique([userId, type, dedupeKey])` (idempotency), `@@index([userId, createdAt])`
(the ordered notification list), `@@index([userId, readAt])` (unread count/list — Postgres's
B-tree handles `IS NULL` lookups on an indexed column), `@@index([swapId])` /
`@@index([tokenMarketId])` (related-entity lookups).

## Realtime delivery

Extends Phase 2's existing `RealtimeService`/SSE machinery rather than building a second
realtime path: one Redis subscriber connection for the whole API process
(`redis.duplicate()`), now subscribed to both `fomo:activity:new` (Phase 2) and
`fomo:notifications:new` (Phase 4), fanned out via two separate RxJS `Subject`s. Because
this service is now used by two feature modules (`SocialModule` and `NotificationsModule`)
that otherwise have no reason to depend on each other, it lives in its own
`apps/api/src/realtime` module rather than being owned by either.

A published ping is deliberately bare — `{ userId, notificationId, type, atIso }` — never
the full notification payload, matching the existing activity-ping convention. The client
treats it as "something changed, go refetch," authenticated over the normal REST endpoint;
a missed or duplicate ping is harmless.

**The SSE authentication problem.** The browser `EventSource` API cannot attach an
`Authorization` header, which is how every other authenticated endpoint in this app
identifies its caller. Embedding the long-lived session JWT directly in the stream URL was
considered and rejected — a session token is a durable, high-value credential, and a URL is
exactly the wrong place for one (access logs, browser history, proxies).

Instead: `POST /notifications/stream-ticket` (authenticated, normal `JwtAuthGuard`) issues a
cryptographically random, single-use ticket, stored in Redis (`notif:ticket:<ticket>` →
`userId`, 30s TTL). `GET /notifications/stream?ticket=...` consumes it atomically (Redis
`GETDEL`) and, on success, opens an SSE stream server-side filtered to that resolved
`userId` — a client can never subscribe to anyone else's notifications by guessing or
reusing a ticket. The ticket still travels in a URL (unavoidable given `EventSource`'s
constraints), so its blast radius is bounded as tightly as possible instead: 30 seconds,
one use, and it grants nothing beyond "receive pings for the userId that requested it" —
never an alternative to the session JWT for any other purpose.

## Failure degradation

- **Postgres up, Redis down:** notifications persist normally; realtime delivery is
  unavailable, so the client falls back to polling/refetch-on-reconnect. Nothing is lost.
- **Redis up, SSE disconnected:** the client refetches persisted state (list + unread count)
  on reconnect, same as Phase 2's activity feed.
- **A notification-layer bug:** every creation call site in `apps/workers` is wrapped in
  try/catch around the fan-out call, logged, and never allowed to fail the ingestion tick —
  a notification bug must not break indexing or trade settlement. The same holds in
  `apps/api`: `FollowService`/`LikeService` wrap their notification call in try/catch so a
  notification failure never surfaces as a failed follow/like.
- **Retries:** every creation path is idempotent (see "Idempotency" above), so a retried
  tick, a re-processed block range, or a retried HTTP request can never duplicate a
  notification.

## API endpoints (`apps/api/src/notifications`)

All under `/v1/notifications`, all requiring a session (`JwtAuthGuard`) and scoped to that
session's own `userId` — never a client-supplied id — except the SSE stream itself (see
above). Rate-limited per the table below; production throttle values are never weakened to
make a test pass.

| Endpoint | Limit | Notes |
|---|---|---|
| `GET /` | 30/min | Cursor-paginated (`createdAt`+`id` keyset, same shape as the activity feed's cursor) |
| `GET /unread-count` | 60/min | |
| `POST /:id/read` | 30/min | Scoped `updateMany({ id, userId })` — someone else's id matches zero rows, not an error/leak |
| `POST /read-all` | 10/min | |
| `GET /preferences` | 30/min | |
| `PATCH /preferences` | 20/min | Partial update, merges onto current preferences |
| `POST /stream-ticket` | 20/min | |
| `GET /stream` (SSE) | 30/min | Ticket-authenticated, see above |

## Security

- **No client-controlled recipient.** Every recipient is resolved server-side (from a
  wallet's linked `userId`, a follow list, or a trade-history query) — a client can never
  say "notify user X."
- **No IDOR.** `markRead`/list/unread-count are all scoped to the caller's own `userId` in
  the query itself, not a separate ownership check after the fact.
- **No spoofed creation.** Notifications are only ever created by trusted server-side domain
  logic (`FollowService`/`LikeService` reacting to a real DB write they just made, or the
  worker reacting to a `Swap` it just indexed) — there is no endpoint that accepts
  "create a notification" as a request body.
- **Self-notification is always excluded** — a user cannot notify themselves by following,
  liking, or trading their own linked wallet.
- **Rate limiting** on every endpoint, per the table above.

## Deferred / known limitations

- `TRENDING_TOKEN`'s audience is every preference-enabled user rather than a narrower
  interest cohort (see "Trending tokens" above) — a deliberate tradeoff given there's no
  "watch this token" feature in this app to scope it to instead; worth revisiting if the
  user base grows large enough for full-broadcast fan-out to become a real cost.
- No push/email/SMS delivery — in-app + realtime only, matching this phase's explicit scope.
- No notification grouping/digesting server-side (e.g. "5 people liked your trade" as one
  row) — each event is its own row; the web notification center may group visually, but the
  data model doesn't collapse them.
