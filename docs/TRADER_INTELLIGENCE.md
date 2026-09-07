# Phase 5: trader intelligence & personalized discovery

Phases 0–4 built market data, social identity, non-custodial trading, and realtime
notifications. Phase 5 turns that indexed data into a trustworthy trader-intelligence and
personalized-discovery layer — no new indexing, no new tables, entirely derived from
`swaps`, `follows`, `activity_likes`, and `trade_transactions` the platform already owns.

**The hard rule governing every metric below: never fabricate a financial performance
number.** If a statistic can't be derived correctly from data Fomo actually has, it's
listed under [Deferred metrics](#deferred-metrics) instead of being approximated.

```text
swaps / follows / activity_likes / trade_transactions   (Postgres, already authoritative)
    ↓
Pure formulas (packages/domain/src/trader-intelligence.ts — no I/O, fully unit-tested)
    ↓
Bounded SQL aggregation (apps/api — GROUP BY / raw aggregates, never a per-row loop)
    ↓
Redis cache-aside for public rankings only (explicit TTL; Postgres remains authoritative)
    ↓
API (apps/api/src/social, apps/api/src/market, apps/api/src/discovery)
    ↓
Fomo Web (apps/web)
```

## Trader statistics

Computed by `TraderService#getProfile` (`apps/api/src/social/services/trader.service.ts`)
from indexed `swaps` where `trader_address` matches, and served as
`TraderProfile.stats` — see `TraderStatsSchema` in `packages/domain/src/wallet.ts`. Every
field is either a direct SQL aggregate or a pure formula in
`packages/domain/src/trader-intelligence.ts` over that aggregate; nothing is a per-swap
loop in application code.

| Field | Definition | Null when |
|---|---|---|
| `totalSwaps` | `COUNT(*)` for this trader | never (0 is real) |
| `buyCount` / `sellCount` | `COUNT(*)` filtered by `side` | never |
| `volumeUsd` | `SUM(volume_usd)`, all-time | never (0 is real) |
| `uniqueTokensTraded` | distinct `token_market_id` count | never |
| `avgTradeSizeUsd` | `volumeUsd / totalSwaps` | `totalSwaps = 0` |
| `largestTradeUsd` | `MAX(volume_usd)`, all-time | `totalSwaps = 0` |
| `volume24hUsd` / `tradeCount24h` | same aggregates, `block_timestamp >= now() - 24h` | never (0 is real once the wallet has ever traded) |
| `buyRatio` | `buyCount / totalSwaps`, in [0, 1] | `totalSwaps = 0` |
| `concentrationIndex` | see below | `totalSwaps = 0` |
| `activityFrequencyPerDay` | `totalSwaps / max(1, daysSinceFirstSeen)` | `totalSwaps = 0` |

**Concentration index.** `computeConcentrationIndex` in `trader-intelligence.ts` implements
a Herfindahl-Hirschman-style index: `sum((tokenVolume / totalVolume)^2)` across every token
the wallet has traded. This is a standard, well-known concentration formula (used broadly
in economics for market concentration), not an invented metric. It ranges from close to 0
(volume spread evenly across many tokens) to 1 (all volume in a single token).

Every field above is nullable exactly where "no data yet" is genuinely true, and never a
fabricated `0` standing in for "unknown" — the same null-vs-zero discipline
`docs/SOURCE_OF_TRUTH.md` establishes for market data.

## Trader activity history

`GET /social/traders/:address/activity` (Phase 2, unchanged in Phase 5) already serves a
cursor-paginated history of confirmed, indexed trades — token, buy/sell direction, USD
amount, timestamp, and transaction hash — reusing the exact same `Swap` → `SocialActivity`
projection the global feed uses. Reviewed against Phase 5's requirements and found already
complete; no changes were needed.

## Trader → token

`GET /social/traders/:address/tokens` (`TraderService#getTraderTokens`) — the tokens a
wallet has traded, aggregated: token identity, trade count, volume, and last activity
timestamp. One `GROUP BY token_market_id` bounded by `limit` (ordered by volume, this
trader's most significant tokens first), then one batched `TokenMarket` lookup for the
returned ids — never a query per token.

## Token → trader

`GET /market/tokens/:address/traders` (`MarketService#getTokenTraders`) returns:

- `uniqueTraders24h` — read directly off `TokenMarket.uniqueTraders24h` (Phase 2's own
  cached column), never recomputed here.
- `recentTraders` — the most recently active *distinct* traders on this token, one query
  (`DISTINCT ON` via Prisma's `distinct` + `orderBy`).
- `activeTraders` — traders with the most trades on this token in the last 24h, one
  `GROUP BY` bounded to that window.
- `recentLargeTrades` — this token's own recent trades at/above
  `LARGE_TRADE_USD_THRESHOLD` (see below), reusing the same `SocialActivity` shape/mapper
  as every other activity listing.

Three bounded queries total, never a loop over traders.

## Trader discovery

Two complementary, transparently-labeled rankings — never "best trader," since Fomo has no
cost-basis data to back a profitability claim (see [Deferred metrics](#deferred-metrics)):

- **Top Traders** (`GET /social/traders/top`, Phase 2, unchanged) — ranked by real 24h
  `SUM(volume_usd)`.
- **Active Traders** (`GET /discovery/active-traders`, new) — ranked by real 24h
  `COUNT(*)` instead. Both share the same `MIN_TRADES_FOR_TRADER_RANKING` floor (2 trades)
  so a single huge or one-off trade can't win either ranking — this constant used to be a
  private copy inside `trader.service.ts`; Phase 5 centralized it into
  `@fomo/domain` so both rankings can never quietly disagree on the floor.

## Large trades

`GET /discovery/large-trades` — recent confirmed swaps at/above `LARGE_TRADE_USD_THRESHOLD`
across every tracked market, newest first. This threshold is `NOTIFICATION_DEFAULTS.
whaleTradeUsdThreshold` from Phase 4 (`packages/domain/src/notifications.ts`), re-exported
as `LARGE_TRADE_USD_THRESHOLD` — the exact same number Phase 4's whale-trade notifications
use, so "large trade" never means two different things in two different parts of the
product.

## Rising

"A measurable increase in activity, never a vibe." Two independent signals, both reusing
data this codebase already computes rather than a new momentum formula:

- **Rising tokens** — a token counts as Rising when it entered trending (Phase 4's
  `TokenTrendingState.becameTrendingAt`) within `RISING_TOKEN_WINDOW_HOURS` (24h). This
  reuses Phase 4's own trending-transition tracking directly; Phase 5 adds no second
  trending algorithm.
- **Rising traders** — a wallet counts as Rising when *both*: (a) its 24h trade count
  clears `RISING_TRADER_CONFIG.minTradeCount24h` (3 — never call a trivial trade count
  "rising"), and (b) that 24h count is at least `RISING_TRADER_CONFIG.multiplier` (2×) the
  wallet's own all-time daily average (`activityFrequencyPerDay`). This is a genuine,
  computable comparison against the wallet's *own* history, not an arbitrary absolute
  count.

**Performance.** Rising traders is the one ranking that could tempt a "for every trader,
check if they're rising" loop — the exact anti-pattern the spec calls out. Instead:
one bounded raw aggregate finds candidates clearing the 24h floor (`LIMIT 100`), one further
bounded `GROUP BY` fetches just those candidates' all-time totals, and `isRisingTrader` runs
in memory over that small, already-fetched array. Two queries total, regardless of how many
wallets have ever traded.

`GET /discovery/rising` returns `{ tokens, traders }` together as one section, matching how
the product frames "Rising" as a single discovery idea.

## Personalization

### Personalized discovery (`GET /discovery/personalized`)

A weighted, deterministic score over a *bounded candidate pool* — exactly the same
discovery-score-gated set of tracked markets `/market/discover` already ranks (Phase 1's own
documented "small, bounded tracked-market count" assumption — see `MarketService#discover`).
Every signal query below is scoped `WHERE token_market_id IN (candidateIds)`; nothing here
queries per-candidate.

```text
score = 0.30 · marketActivityScore        (the token's own computeDiscoveryScore — reused, never recomputed)
      + 0.30 · followedTrader             (a followed trader traded this token in the last 24h)
      + 0.20 · tradingInterest            (the viewer has personally traded this token before)
      + 0.10 · log10(1 + viewerLikeCount) (the viewer liked activity involving this token)
      + 0.10 · max(0, 1 - hoursSince / 72) (recency of the most relevant signal, decaying to 0 over 72h)
```

See `PERSONALIZATION_WEIGHTS` / `computePersonalizationScore` in
`packages/domain/src/trader-intelligence.ts` — every weight and window is a named,
documented constant, not a magic number, and the whole function is pure and unit-tested in
isolation (boundary tests for zero followers, zero likes, exactly-at-the-recency-edge, and
determinism).

Each returned item carries `reasons: string[]` — plain sentences built by
`buildPersonalizationReasons`, one per signal that actually fired ("Alex traded this
recently", "You've traded this before"), falling back to "Active on the market" when no
personal signal applies. Never an unexplained label like "AI picked" or "smart money" — see
the spec's own explicit prohibition on those.

### Personalized feed (`GET /discovery/feed`)

Deliberately **not** a scored re-ranking of activity — reordering a chronological,
cursor-paginated feed by score breaks pagination in subtle ways (an item already sent to a
client could later "belong" on an earlier page). Instead: the personalized feed is a
**union** — followed-trader activity `OR` the same quality-gated general feed
`/social/activity` already uses — ordered by `block_timestamp DESC` exactly like every other
activity feed in this codebase. One `WHERE` clause, one `ORDER BY`, so cursor pagination
works identically to `ActivityService#getGlobalFeed`.

This guarantees the anti-filter-bubble requirement structurally, not by convention: general
market discovery is *always* present in the union, never crowded out. Each item is tagged
`reasonCode: 'FOLLOWED_TRADER' | 'GENERAL_DISCOVERY'` with a matching `reason` string (see
`feedReasonText`), so the client can show "Because you follow Alex" vs "Active on the
market."

Implementation split: `ActivityService#getPersonalizedFeedCandidates`
(`apps/api/src/social/services/activity.service.ts`) owns the query itself — it's 100%
existing activity-pagination machinery, extended in place, with no knowledge of Phase 5
concepts. `DiscoveryService#personalizedFeed` wraps that with the reason tagging, which is
where "why is this here" actually lives.

## Security

- Every personalized endpoint (`/discovery/personalized`, `/discovery/feed`) requires a
  session (`JwtAuthGuard`) and resolves `userId` exclusively from that session — never from
  a query param, body field, or any other client-supplied value. There is no way to request
  another user's personalized view.
- Public rankings (`/discovery/active-traders`, `/discovery/large-trades`,
  `/discovery/rising`, and the extended `/social/traders/:address`,
  `/social/traders/:address/tokens`, `/market/tokens/:address/traders`) expose only data
  already public elsewhere in the product (trade history, follower counts, wallet display
  identity) — nothing about session internals, nonces, or authentication state.
- Rate limiting on every new endpoint — see the table below. Production throttle values are
  never weakened to make a test pass.

| Endpoint | Limit |
|---|---|
| `GET /discovery/active-traders` | 30/min |
| `GET /discovery/large-trades` | 30/min |
| `GET /discovery/rising` | 30/min |
| `GET /discovery/personalized` | 20/min (authenticated) |
| `GET /discovery/feed` | 20/min (authenticated) |
| `GET /social/traders/:address/tokens` | inherits the module default |
| `GET /market/tokens/:address/traders` | inherits the module default |

## Performance & caching

Every ranking is bounded: a fixed time window (24h), a `LIMIT`, and either a single SQL
aggregate or at most two bounded queries chained together (candidate-then-detail, never
candidate-then-N-detail-queries). Nothing in Phase 5 scans the full historical `swaps`
table on a live request.

**Redis caching** (`DiscoveryService#cached`, cache-aside) applies only to the *public*
rankings — active traders, large trades, rising tokens, rising traders — each with an
explicit `DISCOVERY_CACHE_TTL_SECONDS` (30s) TTL. A cache miss or a Redis failure (read or
write) computes fresh from Postgres and degrades gracefully — Redis is never the source of
truth, and an outage never turns into a 500. Personalized endpoints are **not** cached
(they're inherently per-user, and cheap enough not to need to be at Phase 1's current
tracked-market scale — the same assumption `MarketService#discover` already documents).

## Deferred metrics

**PnL, ROI, and win rate are not implemented.** Before any of them could be computed
correctly, Fomo's data model would need:

- **Matched entries and exits** — which specific buy(s) a given sell closes out (FIFO,
  LIFO, or average-cost; `swaps` records each trade independently with no linkage between
  them).
- **Full wallet inventory** — every token a wallet holds, including balances acquired
  *before* Fomo ever indexed a pool the wallet traded on, or via a plain transfer that never
  touched an indexed pool at all. `swaps` only sees activity on tracked Uniswap V3 pools.
- **Cost basis per unit acquired** — the USD price paid at each entry, correctly weighted
  across multiple partial entries.
- **Fees** — gas and any protocol/platform fee, to get a *realized* number instead of a
  gross one.
- **A clear distinction between Fomo-originated trades and a wallet's full on-chain
  activity** — `trade_transactions` (Phase 3) only records trades placed *through* Fomo
  itself, a small subset of what a real wallet does on-chain; `swaps` is indexed pool
  activity generally, with no ownership/inventory model layered on top.

None of these exist today. Computing PnL or win rate from what's actually indexed would
mean guessing at cost basis or silently ignoring off-platform activity — exactly the kind
of fabricated performance number this phase's hard rule prohibits. If a future phase adds
proper wallet-inventory tracking (full transfer history, not just DEX swaps) and a defined
lot-matching methodology, this section is where that gets documented and the schema/API
surface for it gets designed.

**Also out of scope, per the phase's own boundary:** AI recommendations, copy trading,
automated trading, portfolio management, multi-chain, bridges, leverage/perps, lending,
staking, fiat, subscriptions, DMs, native mobile, custody, and private-key handling.
