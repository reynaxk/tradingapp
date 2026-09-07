# Phase 6: retention, watchlists & social sharing

Phases 0–5 built market data, social identity, non-custodial trading, realtime
notifications, and trader intelligence / personalized discovery. Phase 6 adds the
lightweight retention and sharing layer on top — watchlists, saved searches, a return-loop
surface, and shareable public pages — without a second realtime architecture, a second
notification pipeline, or any fabricated engagement mechanics.

```text
TokenWatch / SavedSearch (Postgres, new)                 User.lastDiscoverySeenAt/streak (new columns)
    ↓                                                          ↓
WatchlistService (apps/api/src/market)          ReturnLoopService (apps/api/src/discovery/services)
SavedSearchService (apps/api/src/discovery/services)
    ↓                                                          ↓
NotificationFanoutService#notifyWatchedTokenActivity    computeStreak (packages/domain)
(apps/workers — reuses Phase 4's fan-out shape)
    ↓
Existing Notification table + Phase 4 Redis pub/sub + SSE (no second realtime system)
    ↓
Fomo Web (apps/web) — watch button, watchlist page, saved searches, "what you missed", share
```

## Watchlists

### Data model

```prisma
model TokenWatch {
  id            String   @id @default(uuid())
  userId        String
  tokenMarketId String
  createdAt     DateTime @default(now())

  @@unique([userId, tokenMarketId])
  @@index([userId, createdAt])
  @@index([tokenMarketId])
}
```

Keyed by `tokenMarketId`, not a raw token id — the same convention every other per-token
state table in this codebase already uses (`Notification.tokenMarketId`,
`TokenTrendingState.tokenMarketId`, `TradeQuote.tokenMarketId`). The row's mere existence is
the fact; there is no extra state to a watch. `@@unique([userId, tokenMarketId])` is what
makes watch/unwatch idempotent — `WatchlistService#watch` treats a `P2002` on create as a
successful no-op, exactly the pattern `FollowService`/`ActivityLike` already established.

### API

| Route                           | Method   | Auth                | Notes                                                                                                                                                                                                               |
| ------------------------------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/market/tokens/:address/watch` | `GET`    | `OptionalAuthGuard` | `{ watching: boolean \| null }` — `null` for an anonymous caller, never a fabricated `false`. Mirrors `isFollowedByMe`.                                                                                             |
| `/market/tokens/:address/watch` | `POST`   | `JwtAuthGuard`      | Idempotent create.                                                                                                                                                                                                  |
| `/market/tokens/:address/watch` | `DELETE` | `JwtAuthGuard`      | Idempotent delete.                                                                                                                                                                                                  |
| `/social/watchlist`             | `GET`    | `JwtAuthGuard`      | Cursor-paginated, newest-watched-first; returns `MarketSummary & { watchedAt }` per item — the same shape `/market/discover` already serves, so the watchlist page reuses every existing token-rendering component. |

Mutations live under `MarketModule` (mirroring the existing
`/market/tokens/:address/traders` precedent); listing lives under `SocialModule`
(mirroring `/social/traders/:address/tokens`) via `WatchlistService`, which `MarketModule`
exports specifically so `SocialModule` and `DiscoveryModule` can reuse it rather than a
second `TokenWatch` query implementation.

### Query bounds

- `watch`/`unwatch`/`isWatching`: one `tokenMarket` lookup (address → id) + one
  create/delete/find — never more than two queries, none of them scanning more than a
  single row.
- `listForUser`: one keyset-paginated `findMany` (`ORDER BY createdAt DESC, id DESC`,
  `take: limit + 1`), joined to `TokenMarket`/`Token`/`Chain` in the same query — no N+1.
- `getWatcherCount` (token-detail-page social proof): one `COUNT` scoped to a single
  `tokenMarketId` — never joined across users, never exposes _who_ is watching. Deliberately
  placed on `TokenTraderConnection` (single-token detail view), not on bulk `MarketSummary`
  (discover/search lists), so a list page never pays for N watcher-count aggregations.
- `getWatchedSet` (personalization signal, see below): one `tokenMarketId IN (...)` query
  over the already-bounded discovery candidate pool — never a query per candidate.

## Saved searches

Deliberately minimal: a saved search is a bookmarked query string, nothing more. No stored
result set, no scheduled re-run, no query-language or filter model beyond what
`/market/discover?search=` already accepts.

```prisma
model SavedSearch {
  id          String   @id @default(uuid())
  userId      String
  query       String
  displayName String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, createdAt])
}
```

`MAX_SAVED_SEARCHES_PER_USER` (20, `packages/domain/src/retention.ts`) is enforced in
`SavedSearchService`, not as a DB constraint — the same "business rule lives in the service
layer" pattern the rest of this codebase already uses for bounds like this. Because the cap
keeps the per-user row count small by construction, `list()` is a single unpaginated
`findMany` ordered by `createdAt DESC` — pagination would be over-engineering at a bound of
20 rows.

| Route                           | Method   | Auth           |
| ------------------------------- | -------- | -------------- |
| `/discovery/saved-searches`     | `GET`    | `JwtAuthGuard` |
| `/discovery/saved-searches`     | `POST`   | `JwtAuthGuard` |
| `/discovery/saved-searches/:id` | `DELETE` | `JwtAuthGuard` |

`delete` scopes its `WHERE` to `{ id, userId }` — the IDOR defense: another user's saved
search id simply matches zero rows and the endpoint still reports success, rather than a 403
that would confirm the id exists. Idempotent by construction, same as `unfollow`/`unwatch`.

## Shareable public pages

`/market/[address]` and `/trader/[address]` (Phases 1–2) already satisfy "shareable public
page": clean URLs, work fully unauthenticated, expose only public information, and already
have loading/error/not-found states. **No new `/token/:address` route was created** —
that would duplicate an existing route, which the spec explicitly prohibits. The only
addition is `generateMetadata` on both pages (Open Graph + Twitter card tags), computed from
the same public data `fetchToken`/`fetchTraderProfile` already serve, so a shared link
renders a real preview instead of a generic one.

## Shareable activity cards

No new per-swap detail route. `ShareButton` (`apps/web/components/social/ShareButton.tsx`)
shares a link to the existing `/market/{tokenAddress}` page, where the trade is visible in
context via the activity feed already rendered there — satisfying "the shared URL must
point to the underlying public activity/entity" without a second page to keep in sync.

`ShareButton` is copy-link + the native Web Share API where the browser has one, with a
small dropdown-panel fallback when it doesn't (reusing `NotificationBell`'s own
self-contained outside-click/Escape-to-close pattern). **Explicitly not implemented, per the
phase's own boundary:** social-media API integrations, image/screenshot generation, and
server-side rendering of a shareable image. A plain link is the entire feature.

Placed on the token detail page, the trader profile page, and activity cards (large trades,
followed-trader trades) — every place a "here's a thing I saw" action already makes sense in
this product, and nowhere else.

## Notification integration

One new type: `WATCHED_TOKEN_ACTIVITY` — a large trade in a token the recipient is
watching. Deliberately narrow in scope:

- **Trigger:** the exact same "large trade" definition `WHALE_TRADE` uses
  (`NOTIFICATION_DEFAULTS.whaleTradeUsdThreshold`) — not a second, competing definition of
  "meaningful."
- **NOT implemented:** "watched token becomes trending" (already covered by the existing
  `TRENDING_TOKEN` broadcast, which already reaches every preference-enabled user, watchers
  included) and "watched token price move" (would need a stored reference price, which
  doesn't cleanly fit the existing swap-triggered fan-out architecture — see [Deferred
  work](#deferred-work)).
- **Recipients:** watchers of the token, **excluding** anyone with a confirmed
  `TradeTransaction` in that token — that cohort is `WHALE_TRADE`'s own audience. This makes
  the two notification types' recipient sets disjoint _by construction_, so a user can never
  receive both notifications for the same swap.
- **Cooldown:** reuses `NOTIFICATION_DEFAULTS.whaleTradeCooldownMinutes`, scoped
  independently per `type` in the cooldown query — a token on `WHALE_TRADE` cooldown can
  still trigger `WATCHED_TOKEN_ACTIVITY` and vice versa, since they gate different audiences.
- **Preference:** `NotificationPreference.watchedTokenActivity` (opt-out by default, same as
  every other preference).
- **Self-notification:** never — a watcher who is also the trader behind the exact swap is
  excluded, same check `WHALE_TRADE`/`FOLLOWED_TRADER_TRADE` already apply.

### Bounded fan-out

`NotificationFanoutService#notifyWatchedTokenActivity` (`apps/workers`), hooked into the
same `notifyOnInsertedSwaps` call site as `notifyWhaleTrades`, in the same tick:

1. Filter this tick's swaps to those at/above the threshold.
2. One `notification.findMany` (`type: 'WATCHED_TOKEN_ACTIVITY'`, cooldown window) to find
   tokens already on cooldown — never per-token queries.
3. One `tokenWatch.findMany` scoped to the remaining eligible `tokenMarketId`s — the entire
   watcher set for every eligible token in a single query.
4. One `tradeTransaction.findMany` (same eligible ids) to build the excluded "already
   WHALE_TRADE's audience" set.
5. One `wallet.findMany` to resolve self-notification exclusion, one preference batch query.
6. One `createMany({ skipDuplicates: true })`.

This is the exact shape the spec calls out as required and the anti-pattern it forbids: at
no point does this loop "for every swap, query every user watching that token" — the watcher
query is one bounded `IN` clause over the whole tick's eligible tokens, regardless of how
many swaps or how many watchers exist.

## Personalization

`isWatched: boolean` was added to `PersonalizationSignals` and a new `watchlist: 0.25`
weight to `PERSONALIZATION_WEIGHTS` (`packages/domain/src/trader-intelligence.ts`), **on top
of** the five Phase 5 weights, without rebalancing any of them — a non-watched token's score
is bit-for-bit unchanged from Phase 5. `DiscoveryService#personalizedDiscovery` resolves the
signal via `WatchlistService#getWatchedSet(userId, candidateIds)` — one bounded `IN` query
added to the same `Promise.all` batch as every other signal, never a query per candidate.

"Watchlist ≠ automatic top ranking," per the spec: 0.25 is smaller than `marketActivity`
(0.30) and `followedTrader` (0.30) individually, so a single watched token can nudge a
result without being able to outrank a token that's both objectively active _and_
followed-trader-relevant — see the domain test `a single watched token cannot outrank a
token both objectively active and followed-trader-relevant` in
`trader-intelligence.test.ts`. `buildPersonalizationReasons` surfaces a matching "You're
watching this token" reason whenever the signal fires, alongside every other fired reason —
never replacing them.

## Return loop

The "what you missed" surface: a thin read over the _existing_ `Notification` table — no new event-sourcing model, no
duplicated feed. Two new fields on `User`:

- `lastDiscoverySeenAt: DateTime?` — null until the first `POST /discovery/mark-seen` call.
- `currentStreakDays` / `longestStreakDays: Int` — the _only_ engagement number this product
  tracks. No points, XP, badges, or leaderboard — explicitly out of scope per the spec.

### Endpoints

- `GET /discovery/whats-missed` — `{ items: NotificationDto[], totalUnseen, currentStreakDays,
longestStreakDays }`. `items` is `createdAt > lastDiscoverySeenAt`, bounded to
  `WHATS_MISSED_MAX_ITEMS` (20) via `LIMIT`, reusing `toNotificationDto` and
  `NOTIFICATION_INCLUDE` entirely — a preview, not the full unread list (the notification
  center already serves that, paginated).
- `POST /discovery/mark-seen` — advances the streak (see below) and stamps
  `lastDiscoverySeenAt = now()`. Called once per discover-page visit by
  `WhatsMissedSection`, _after_ `whats-missed` has already been read, so the current visit's
  items always reflect what happened _before_ this visit — marking seen only changes what the
  _next_ visit will show.

### Streaks

`computeStreak` (`packages/domain/src/retention.ts`) is a pure function of `(previous state,
now)`: same UTC calendar day as last seen → no change; the very next UTC day → `+1`; a gap of
2+ days → reset to `1`. `ReturnLoopService#markSeen` reads the row, calls `computeStreak`,
then overwrites with the result — a **plain overwrite, never a compare-and-swap**.

This is deliberately what makes it race-safe across multiple browser sessions/tabs: every
writer is the _same_ user, so two concurrent calls on the same UTC day read the same
`previous` state and compute the _identical_ `next` state — there's no real conflict to
resolve, just two writers agreeing on one answer. See the domain test `is race-safe: two
concurrent calls on the same day from the same user compute the identical result`.

UTC-day boundary is a disclosed simplification: a user's local "today" can disagree with
UTC's near midnight. Accepted rather than adding per-user timezone tracking for a single
subtle signal — see [Known limitations](#known-limitations).

## Social proof

- **Watched-by count** — `TokenTraderConnection.watcherCount`, a single bounded `COUNT`
  scoped to one token, shown on the token detail page only (never on bulk list views, to
  keep those pages to one cheap query). Aggregate only — the API never exposes _who_ is
  watching.
- Notable-trader counts, recent large trades, and trader counts were already public in
  Phase 5's `TokenTraderConnection`/`TraderProfile` — Phase 6 adds no new social-proof
  surface beyond the watcher count above.

## Security

- **Every mutation resolves `userId` from the session (`JwtAuthGuard`/`@CurrentUser()`),
  never from a client-supplied id, body field, or query param.** Watch/unwatch, saved-search
  create/delete, and mark-seen all follow this without exception.
- **Cross-user isolation is enforced in the `WHERE` clause of every read and write**, not by
  a separate authorization check: `listForUser`/`list` scope to `{ userId }`;
  `unwatch`/`delete` scope to `{ ..., userId }` so another user's row simply doesn't match.
  This is the same pattern `FollowService`/`LikeService` already use, and is what the IDOR
  tests in `watchlist.e2e-spec.ts` verify directly (one user's watch/saved-search is
  invisible and unmodifiable to another).
- **Public share pages expose only what was already public** — `MarketSummary` and
  `TraderProfile` fields, no session internals, no notification/watchlist state about
  _other_ users.
- **Rate limiting** on every new mutation (`@Throttle`), values below. Never weakened to make
  a test pass — rate-limit-heavy e2e `describe` blocks get their own Nest app instance (own
  in-memory throttler storage), the same isolation pattern every prior phase established.

| Endpoint                                                                                | Limit                                                                                                                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` / `DELETE /market/tokens/:address/watch`                                         | 20/min (authenticated)                                                                                                                                                         |
| `POST /discovery/saved-searches`                                                        | 30/min — deliberately above `MAX_SAVED_SEARCHES_PER_USER` (20), so hitting the cap is always its own observable 400, never masked by a 429 from the rate limiter along the way |
| `DELETE /discovery/saved-searches/:id`                                                  | 20/min                                                                                                                                                                         |
| `POST /discovery/mark-seen`                                                             | 20/min                                                                                                                                                                         |
| `GET /social/watchlist`, `GET /discovery/whats-missed`, `GET /discovery/saved-searches` | inherit the module default                                                                                                                                                     |

## Performance & caching

- Every new list endpoint is cursor-paginated with a bounded `take` (watchlist) or capped by
  a small documented constant (saved searches, what's-missed) — no unbounded `findMany`.
- No new caching was added. Watchlist/saved-search/return-loop state is inherently
  per-user, so — matching Phase 5's own documented reasoning for not caching personalized
  endpoints — caching it would either require per-user cache keys (marginal benefit at
  current scale) or risk leaking one user's state into another's response (an explicit
  anti-goal). The one new _aggregate_ value (`watcherCount`) is cheap enough (a single
  indexed `COUNT`) not to need caching yet; if watcher counts become expensive at scale, the
  existing `DiscoveryService#cached` Redis cache-aside pattern is the documented next step.
- Existing Phase 4 Redis pub/sub + SSE is reused as-is for `WATCHED_TOKEN_ACTIVITY` delivery
  — no second realtime system.

## Web UX

No unrelated redesign — every new surface reuses this app's existing primitives and
patterns:

- `WatchButton` mirrors `FollowButton`'s exact optimistic-toggle-with-rollback shape, in a
  labeled variant (token detail page) and a compact icon-only star variant (watchlist rows)
  — both carry a real `aria-label`/`aria-pressed`, never icon-only for a screen reader.
- `ShareButton` reuses `NotificationBell`'s self-contained outside-click/Escape-to-close
  dropdown pattern for its copy-link fallback panel.
- The watchlist page (`/watchlist`) reuses `TokenIdentity`/`PriceChange`/`EmptyState`/
  `Skeleton` — the same components the discover page and token detail page already use —
  rather than a second set of token-row components. Its empty and loading states match
  `TradeHistoryList`'s existing shape for a personal, session-gated list.
- "What you missed" is a single quiet `Surface` banner, not a modal or a badge that would
  compete with the notification bell's own unread indicator — shown once per visit only
  when something is genuinely new, never a persistent nag.

## Retention mechanics that were deliberately NOT built

Per the spec's own instruction to omit and document rather than force a model: no XP, no
points, no coins, no badges, no leaderboard. `currentStreakDays`/`longestStreakDays` is the
one number this product surfaces, shown as plain text ("🔥 4-day streak"), never gamified
with animation, sound, or a progress bar.

## Known limitations / deferred work

- **Streak day boundary is UTC, not per-user local time.** A user near a UTC-midnight
  boundary could see their streak reset (or extend) at a time that doesn't match their own
  "today." Accepted as a disclosed simplification for a single subtle signal — per-user
  timezone tracking isn't otherwise needed anywhere in this codebase.
- **`WATCHED_TOKEN_ACTIVITY` does not cover price moves**, only large trades. A stored
  reference price (and the staleness/invalidation questions that come with one) doesn't fit
  the existing swap-triggered fan-out architecture cleanly; revisit if/when Phase 2's price
  snapshot model grows a "reference point" concept for other reasons.
- **Saved searches store only the raw query string** — no structured filters (chain, sort,
  min-liquidity, etc.) beyond what `/market/discover?search=` itself accepts today. If
  `/market/discover` grows a richer filter model, saved searches should be revisited to
  capture that structure rather than a single string.
- **No push notifications, email digests, or Discord/Telegram delivery for "what you
  missed"** — explicitly out of scope per the spec's own boundary list; the in-app surface
  and the existing notification center are the only delivery channels.
- **The saved-search cap has a narrow race window under concurrent requests from the same
  user**: `SavedSearchService#create` checks the count and inserts as two separate
  statements, not one atomic operation, so two truly simultaneous creates from the same
  account could both pass the check and land the user one row over
  `MAX_SAVED_SEARCHES_PER_USER`. Accepted because the cap is a soft product limit (not a
  security or billing boundary) and the race is self-inflicted — a user can only ever race
  against their own other request, never another user's. A `SERIALIZABLE` transaction with
  retry-on-conflict would close this fully if the cap ever needs to be exact.

## Explicitly out of scope (per the spec's own boundary, unchanged from Phases 1–5)

AI recommendations, copy trading, automated/social trading execution, creator payouts,
referral commissions, paid promotion, token launchpads, multi-chain execution, bridges,
leverage, perpetuals, lending, staking, fiat payments, custodial wallets, private-key
storage, server-side signing, push notifications, email marketing, Discord/Telegram
integrations, social-media API integrations, complex gamification, and full PnL/ROI
accounting (see `docs/TRADER_INTELLIGENCE.md#deferred-metrics` — unchanged by this phase).
