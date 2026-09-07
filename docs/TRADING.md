# Phase 3: wallet and trading architecture

Phase 1 made Fomo see the market. Phase 2 made it social. Phase 3 closes the loop —
**Discover → See activity → FOMO → Connect wallet → Get quote → Review trade → User signs →
Transaction submitted → Blockchain confirms → Phase 1 indexer detects the swap → Social
activity appears** — without Fomo's backend ever holding a private key, a seed phrase, or
the ability to move a user's funds. See `docs/SOURCE_OF_TRUTH.md` and `docs/WALLET_SECURITY.md`
first; this document assumes both and doesn't repeat their general rules.

```text
User's own wallet (browser extension / mobile / WalletConnect)
        │  1. connects (wagmi) — an address, not yet a proven identity
        ▼
Fomo API — wallet ownership challenge (EIP-4361 message + single-use nonce)
        │  2. the WALLET signs the challenge — Fomo never touches this key
        ▼
Fomo API — verifies the signature, links the wallet to the session's User
        │  3. wallet is now "verified" — trading is unlocked for it
        ▼
Fomo API — quote (Trade Router → 0x aggregator → real DEX liquidity)
        │  4. server prepares an UNSIGNED transaction; never signs it
        ▼
User's own wallet — reviews and SIGNS the prepared transaction
        │  5. wallet broadcasts the signed transaction itself
        ▼
Blockchain (Base) — the transaction executes on-chain
        │  6a. Fomo records the tx hash, polls the chain for a real receipt
        │  6b. independently —
        ▼
Phase 1 Indexer (apps/workers/src/market/ingestion.ts) — detects the Swap event
        ▼
Social Activity (Phase 2, unchanged) — the trade appears in the feed
```

Two independent paths run off the same broadcast transaction (6a/6b above) — see
[Indexer integration](#indexer-integration) for why that's a deliberate design choice, not
an accident.

## Non-custodial security

Structural, not a policy: Fomo's database has nowhere to put a private key or a seed
phrase, and no code path ever asks a wallet for one.

- **`WalletChallenge`, `TradeQuote`, and `TradeTransaction`** (`packages/db/prisma/schema.prisma`)
  store an address, a nonce, a message, a prepared-but-unsigned transaction, and (once
  broadcast) a transaction hash — never a signature's private inputs, never a key.
- **The one signature Fomo ever verifies** (wallet-ownership) is checked, not stored raw —
  see [Wallet ownership](#wallet-ownership). There's no column for it.
- **Every transaction the API builds is unsigned** (`TradeQuote.unsignedTx`:
  `{to, data, value, gas, maxFeePerGas, maxPriorityFeePerGas}`) and stays that way until the
  user's own wallet signs and broadcasts it client-side
  (`apps/web/components/trading/TradePanel.tsx`, via wagmi's `sendTransaction`/
  `writeContract`). Fomo's backend calls neither.
- **The platform fee is collected atomically inside the swap itself** (see
  [Fees](#fees)) — there is no intermediate step where Fomo's backend holds the user's
  money, even briefly.

## Chain scope

Exactly one chain: Base (`eip155:8453`), the same chain Phase 1/2 already index. Phase 3
does not add multi-chain execution or bridging. `apps/api`'s numeric `CHAIN_ID` env var
names it directly (rather than parsing `CHAIN_IDENTIFIER` at request time); `apps/web`'s
matching `NEXT_PUBLIC_CHAIN_ID`/`NEXT_PUBLIC_CHAIN_RPC_URL` drive wagmi's single-chain
config (`apps/web/lib/wagmi-config.ts`). Because the chain is singular and server-fixed,
there is no client-suppliable "chain id" parameter anywhere in the trading API for a
malicious or careless client to get wrong — the wrong-network failure mode only exists on
the wallet side (see [Wrong network](#wallet-connectivity)), and it's caught there before a
quote is ever requested.

## Wallet connectivity

`apps/web/lib/wagmi-config.ts` + `apps/web/components/wallet/ConnectWalletButton.tsx`.
wagmi's `injected()` connector covers every desktop browser-extension wallet (MetaMask,
Rabby, Coinbase Wallet's extension — they all inject the same EIP-1193 interface) and any
mobile wallet's in-app browser. WalletConnect is additive and optional
(`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`) for true QR-code mobile pairing — simply omitted,
never broken, when that project id isn't configured.

`wagmi/connectors`' own `coinbaseWallet()` connector is deliberately **not** used: at the
versions this monorepo pins, it pulls in `@coinbase/cdp-sdk`'s optional x402-payments code
path, which statically imports `@x402/*` packages this app doesn't install (a real upstream
packaging issue) and which Next's webpack build cannot resolve. `next.config.mjs` also
carries a targeted `webpack.IgnorePlugin` for the same reason — wagmi's connectors *barrel
file* re-exports `coinbaseWallet`/`baseAccount` unconditionally even though this app never
constructs them, and ES module imports are resolved for the whole file graph before
tree-shaking removes anything unused.

`ConnectWalletButton` exposes address, chain id, connection status, disconnect, and —
**critically** — a distinct "Wrong network — Switch to Base" state whenever the connected
wallet is on any chain but Base. Nothing downstream (`TradePanel`) ever requests a quote
while the wallet is on the wrong network; it shows the same connect/switch UI instead of
silently executing against a chain the user didn't intend.

## Wallet ownership

A connected address is a **claim**, never proof. Ownership is only established by signing a
message Fomo itself generated, over a nonce Fomo itself issued and consumed exactly once.

```http
POST /identity/wallet/challenge   { address }         → { nonce, message, expiresAt }
POST /identity/wallet/verify      { nonce, signature } → { address, verifiedAt, lastUsedAt }
GET  /identity/wallets                                 → [{ address, verifiedAt, lastUsedAt }]
DELETE /identity/wallets/:address
```

(`apps/api/src/identity/wallet.service.ts`, `identity.controller.ts`.)

- **The message is EIP-4361-shaped** (`packages/domain/src/wallet-auth.ts#buildSiweMessage`):
  domain, address, a human statement, URI, chain id, nonce, issued-at, and a 5-minute
  expiration (`WALLET_CHALLENGE_TTL_MINUTES`) — all embedded in the signed text itself, so a
  signature can't be replayed against a different domain or chain.
- **The nonce is cryptographically random** (`randomBytes(16)`, hex-encoded), **stored
  verbatim** as `WalletChallenge.nonce` (`@unique`), and **consumed atomically**:
  `verifyChallenge` flips `usedAt` from `null` via a conditional `updateMany` — if a
  concurrent request already consumed it, the count is `0` and the second caller is
  rejected, closing the double-verify race rather than trusting a read-then-write.
- **The challenge is bound to the session that requested it** (`WalletChallenge.userId`,
  required): verifying with a valid signature but a different session's nonce is rejected
  before the signature is even checked — see the e2e test "no cross-user wallet linking."
- **The signature is verified, never stored raw** — `verifyEvmSignature`
  (`packages/chain-adapters/src/signature.ts`) wraps viem's `verifyMessage` for pure EOA
  recovery. It does not pass an RPC client, so an ERC-1271 smart-contract wallet's signature
  comes back "not verified," not "verified" — a disclosed limitation (see
  [Known limitations](#known-limitations)), not a silent gap.
- **Re-verifying a wallet already linked to a different account moves the link.** Proof of
  key control outranks whoever claimed the address first — see the comment in
  `wallet.service.ts#verifyChallenge`.
- **Unlinking detaches, never deletes** the underlying `Wallet` row — it may still carry
  real, public trading history (`Swap.traderAddress`, `Follow`) that must keep existing.
- **Every private trading endpoint re-derives ownership from the database on every call**
  (`QuoteService#assertWalletOwnership`): `wallet.userId === callingUser.id &&
  wallet.verifiedAt !== null`. A client-asserted `walletAddress` in a request body is never
  trusted on its own.

## Financial precision

Every token amount, fee, and minimum-output figure that touches persistence or comparison
logic is an exact `bigint` over raw (pre-decimals) integer units — never a JS `Number`,
which cannot represent an 18-decimal token amount exactly. Concretely:

- **Parsing user input**: `parseUnits(amount, decimals)` (viem) turns a decimal string into
  an exact raw integer — never `Number(amount) * 10 ** decimals`, which loses precision for
  large or high-decimal values.
- **Fee and slippage math**: `calculateFeeAmount`/`calculateMinOutputAmount`
  (`packages/domain/src/trading.ts`) are pure `bigint` arithmetic
  (`(amount * bps) / 10_000n`) — no floating-point division anywhere in the fee path.
  `platformFeeBps` is always a parameter passed in from server config, never a hardcoded
  literal like `0.005`.
- **Persistence**: every raw amount column on `TradeQuote`/`TradeTransaction` is a `String`
  (schema.prisma), not a numeric type that Prisma would round-trip through a JS `Number` —
  see the field comments on those models.
- **Display only**: a raw `bigint` is converted to a human string via `formatUnits` purely
  for rendering (`*Formatted` fields on the DTOs, `QuoteSummary`/`TransactionDetail` in
  `apps/web`) — the underlying exact value is never derived *from* that display string.
- **The one sanctioned exception**: `estimatedPriceImpact`, a small display percentage from
  0x (never a token amount), is parsed with `Number.parseFloat` in
  `zero-ex-router.service.ts#parsePriceImpactBps` — explicitly justified there as outside
  the token/fee-math rule this section describes.

## Quote system

`GET /trade/quote?side=&tokenAddress=&walletAddress=&amount=&slippageBps=`
(`apps/api/src/trading/quote.service.ts`, `trading.controller.ts`).

1. Normalizes and verifies the caller actually owns `walletAddress` (above).
2. `SafetyService#assertTradable` (`apps/api/src/trading/safety.service.ts`) — see
   [Token safety](#token-safety).
3. Resolves input/output tokens for the requested side (BUY: pay in the market's quote
   token, receive the base token; SELL: the reverse) and parses `amount` into exact raw
   integer units via viem's `parseUnits` — never a JS `Number`.
4. Asks the configured `SwapRouter` (see [Provider](#provider)) for a real, executable
   quote. **No response is ever fabricated**: if the router returns `null` (no liquidity, a
   network failure, an unparseable/incomplete response), the API returns an honest
   `422 No live quote is available for this trade right now` — never an invented price.
5. Sanity-checks the provider's own `minBuyAmount` against what the requested
   `slippageBps` should guarantee (`calculateMinOutputAmount`) — rejects the quote if the
   provider's floor is looser than the client actually asked for.
6. Computes the platform fee (see [Fees](#fees)), classifies price impact (see
   [Price impact](#price-impact)), and persists a `TradeQuote` row with a short expiry
   (`TRADING_DEFAULTS.quoteTtlSeconds`, 30s).
7. Returns a `TradeQuoteDto` — every figure the UI shows (`docs` below) comes from this one
   response; nothing is recomputed client-side except unit-safe display formatting.

Trading is scoped to **markets Fomo already tracks** — a token page only exists for one of
these — so "does this token exist / have decimals / have a route" reduces to "is it one of
our tracked, healthy `TokenMarket` rows," reusing Phase 1's own gates rather than a second
safety system (see [Token safety](#token-safety)).

## Provider

`SwapRouter` (`apps/api/src/trading/router/swap-router.interface.ts`) is a two-method
interface — `getQuote()` returning a normalized `SwapRouterQuote` or `null` — bound via a DI
token (`SWAP_ROUTER`, mirroring the existing `REDIS_CLIENT` pattern) so the concrete
provider can change later without touching `QuoteService`.

`ZeroExSwapRouter` (`apps/api/src/trading/router/zero-ex-router.service.ts`) is the only
implementation: 0x's Swap API, Allowance-Holder quote endpoint
(`/swap/allowance-holder/quote`). Fomo never implements its own AMM math or invents a
price — every number in a quote traces back to 0x's response. The platform fee is passed as
`swapFeeRecipient`/`swapFeeBps`/`swapFeeToken` query params so 0x collects it **inside the
same transaction the user signs**, atomically, with Fomo's backend never touching the funds
in between (see [Fees](#fees)). `requiresApproval`/`approvalSpender` are read from 0x's
`issues.allowance` field and surfaced to the client so the trading UI can show an explicit
ERC-20 approval step before the swap itself, when one is needed.

This adapter is written against 0x's long-standing Allowance-Holder contract as documented
publicly; it could not be exercised against a live 0x API key in this environment (see
[Known limitations](#known-limitations)) — re-verify field names against 0x's current docs
before depending on this in production.

## Fees

`PLATFORM_FEE_BPS` (env-configured, default `50` = 0.50%) is the **only** source of the fee
rate — never a hardcoded literal like `0.005` anywhere in the codebase, and never
overridable by a client (there is no fee field anywhere in the request shape a client could
even set). `calculateFeeAmount(amountRaw, feeBps)` (`packages/domain/src/trading.ts`) does
exact `bigint` math (`(amount * feeBps) / 10_000n`) — never floating point.

The fee is denominated in the trade's **output** token and is either:

- **the aggregator's own reported fee** (`routerQuote.feeAmountRaw`, when 0x's
  `fees.integratorFee` is present — since 0x itself is the one enforcing the fee inside the
  transaction it constructs), or
- **computed the same way, from the quote's own output amount**, when the provider doesn't
  echo one back.

Either way, the number shown in the trading UI (`QuoteSummary`'s "Fomo fee" row) is read
directly from the persisted `TradeQuote.platformFeeAmount` — there is no separate
client-side fee calculation to drift from what's actually encoded in the transaction the
user signs. **No fixed-dollar minimum fee is applied** — a flat `$0.50` minimum would create
extreme effective rates on small trades; `TRADING_DEFAULTS.platformFeeMinUsd` exists as a
typed, documented off switch (`null` by default) for exactly this reason, left disabled
absent a strong reason to add one.

## Slippage

`slippageBps` is explicit, user-adjustable, and bounded server-side
(`TRADING_DEFAULTS.minSlippageBps = 1`, `maxSlippageBps = 2000`, `defaultSlippageBps = 50` =
0.5%) — `QuoteQueryDto` rejects anything outside that range with a 400 before it ever
reaches a service. There is no "unlimited slippage" path. The web UI
(`components/trading/SlippageControl.tsx`) offers 0.1%/0.5%/1% presets plus a custom input
clamped to the same bounds via `isValidSlippageBps`, and shows its own (UI-only, not
server-enforced) warning above 3% — a heuristic nudge, not a second source of truth for the
real limit.

`calculateMinOutputAmount(expectedOutputRaw, slippageBps)` is what "slippage protection"
concretely means here: the floor the built transaction actually enforces on-chain. The API
double-checks the provider's own floor against this calculation before ever returning a
quote (see [Quote system](#quote-system), step 5).

## Price impact

Read directly from the aggregator's own response (0x's `estimatedPriceImpact`, a decimal
percentage converted to bps) — Fomo never estimates it independently.
`classifyPriceImpactBps` (`packages/domain/src/trading.ts`) buckets it into `normal` /
`high` (≥ 500 bps, a visible warning) / `extreme` (≥ 1500 bps, a stronger warning) without
blocking the trade outright at either threshold — the user can still choose to proceed, but
never without seeing the number. `QuoteSummary` renders the literal warning copy ("⚠ High
price impact — this trade may move the market by X%").

## Token safety

`SafetyService#assertTradable` gates every quote on:

1. **Is it a tracked market at all?** (`TokenMarket` lookup by base-token address,
   case-insensitive) — 404 otherwise.
2. **Are decimals known for both sides?** — 422 if not (an unknown-decimals token cannot be
   priced or formatted safely).
3. **Does it clear Phase 1's own liquidity floor** (`DISCOVERY_RANKING.minLiquidityUsd`) —
   422 below it.
4. **Is the price snapshot fresh** (`isPriceStale`, the same staleness rule Discover already
   applies) — 422 if stale.

This deliberately reuses Phase 1's discovery gates rather than building a second, parallel
safety system. **Fomo never claims a token is "safe."** Every quote and review screen shows
the fixed, honest disclosure `SAFETY_DISCLAIMER` — *"No known issues detected by available
checks."* — never "Safe," never "Verified." The checks are real (liquidity, staleness, that
a route exists) but bounded; they are not a security audit.

## Transaction construction

A quote's `unsignedTx` is exactly what an EVM wallet expects to sign:
`{to, data, value, gas, maxFeePerGas, maxPriorityFeePerGas}` — sourced verbatim from the
aggregator's own prepared calldata (Fomo does not construct calldata itself). The web client
(`TradePanel#handleConfirmAndSign`) hands this straight to wagmi's `sendTransaction`,
converting each numeric field to a `bigint` via `BigInt(...)` (which accepts both decimal
and `0x`-prefixed hex strings, matching either encoding a provider might use) — never a
JS `Number`, never a re-derived value.

When `requiresApproval` is set, the UI first sends a standard ERC-20 `approve(spender,
exactInputAmount)` call (via wagmi's `writeContract`, using viem's built-in `erc20Abi`) for
**exactly** the quote's input amount — never an unlimited/infinite approval — and waits for
that transaction's own receipt before offering "Confirm & sign" for the swap itself.

## Quote expiration

Every `TradeQuote` carries `id`, `createdAt`, `expiresAt` (`quoteTtlSeconds` = 30s from
creation), `provider`, the requested amount/tokens/wallet/slippage, and the computed fee —
see the model comment in `schema.prisma`. `isQuoteExpired(expiresAt, now)`
(`packages/domain/src/trading.ts`) is the one place "is this quote still good" is decided,
used both server-side (documented for future re-validation hooks) and client-side
(`TradePanel`, which refuses to let a user sign a quote past its `expiresAt` — the review
screen shows "This quote expired — refresh it" instead of a stale "Confirm & sign").

**`POST /trade/transactions` rejects submission against an expired quote** — see
[Transaction submission](#transaction-submission). An earlier version of this document
argued the opposite (that by submission time the wallet had already broadcast, so
rejecting the recording couldn't undo anything and the check would be "meaningless"). That
reasoning missed the actual attack it needs to defend against: a stale, expired `quoteId`
being replayed later against a **different, unrelated transaction hash** — not the honest
"my own broadcast raced past a 30-second timer" case. Combined with the on-chain match
check in [Transaction integrity](#transaction-integrity), the expiry check closes off
reusing an old quote as a container to attach a hash that was never the trade Fomo actually
reviewed at that price. It still cannot and does not attempt to undo a transaction the
wallet already broadcast — it only refuses to let Fomo's own records treat an expired
quote's stale price/terms as the reviewed trade going forward.

## Transaction integrity

**A successful on-chain receipt is necessary but never sufficient to confirm a trade.** A
receipt only proves *some* transaction with a given hash succeeded — it says nothing about
*which* trade that was. Without checking further, nothing would stop a client from
submitting any arbitrary, unrelated transaction hash it can find with a successful receipt
(its own past transaction, someone else's, even a well-known public one) and having Fomo
eventually mark the associated quote CONFIRMED, fabricating a trade that never actually
happened as quoted.

`transactionMatchesQuote` (`packages/domain/src/trading.ts`) is the check that closes this:
given the transaction's real on-chain `from`/`to`/`value`/`data` (read via
`EvmChainDataProvider#getTransactionDetails`, `packages/chain-adapters`) and the wallet
address plus `unsignedTx` a quote actually persisted, it requires an **exact** match on all
four:

- **Sender (`from`)** — the wallet the quote was created for, and re-verified as owned by
  the caller (see [Authorization](#authorization)) — not merely "a" successful transaction.
- **Destination (`to`)** — the exact router/contract address the quote's `unsignedTx.to`
  named, never a different contract.
- **Value** — the exact native-token amount, as a `bigint`, never approximated.
- **Calldata (`data`)** — byte-for-byte identical to `unsignedTx.data`. Since the client
  hands this exact field to the wallet for signing (`TradePanel#handleConfirmAndSign`)
  without ever modifying it, a real, honest submission's calldata always matches exactly;
  anything else is either a wrong hash or a forged one.

Chain correctness is implicit rather than a separate field check: `getTransactionDetails`
reads from the one RPC configured for Fomo's single supported chain
(see [Chain scope](#chain-scope)), so a hash that only exists on a different chain simply
resolves to "not found" here.

This check runs in two places, for two different reasons:

1. **At submission** (`TransactionService#submitTransaction`) — best-effort and fail-fast.
   If the transaction is already visible to Fomo's RPC (mined, or already propagated to
   that node's mempool), a mismatch is rejected immediately, before a `TradeTransaction`
   row is ever created — the fastest, clearest feedback, and the smallest possible window
   for a bad row to exist at all. If the transaction isn't visible yet (a very recent
   broadcast that hasn't propagated to this specific RPC), this can't be decided from here
   — that's fine, because of (2).
2. **Before every CONFIRMED transition** (`TransactionService#refreshStatus`, and
   independently in `apps/workers/src/trading/sweep.ts` — see
   [Transaction lifecycle](#transaction-lifecycle)) — authoritative and race-free. Both
   only ever run this check once `getTransactionReceiptStatus` has already confirmed the
   transaction is mined, at which point `getTransactionDetails` reading the same hash is
   guaranteed to see it too — no propagation-race ambiguity is possible at this point. A
   receipt that says "success" for a transaction that fails this match is marked **FAILED**,
   with a clear `failureReason` — never left PENDING (which would just keep re-checking a
   thing that will never resolve differently) and never CONFIRMED (which would be exactly
   the fabrication this check exists to prevent).

Because (2) is authoritative and runs independently of (1) on every path to CONFIRMED, a
gap in the submission-time check (e.g. the not-yet-visible case) can never actually result
in an unrelated transaction being confirmed — it only ever delays when the mismatch is
caught, never whether it is.

## Transaction submission

`POST /trade/transactions { quoteId, walletAddress, txHash }`
(`apps/api/src/trading/transaction.service.ts#submitTransaction`) records a transaction the
wallet has **already** signed and broadcast — there is no other way a `TradeTransaction` row
comes into existence, and no row is ever created for a quote the user never acted on or a
signature the wallet rejected. The backend never trusts the client for anything beyond "here
is a hash to track":

- Verifies the quote belongs to the caller and names the same wallet.
- Validates `txHash` is a well-formed 32-byte hash before touching the database.
- **Rejects an expired quote** (`quote.expiresAt <= now`) — see the note above.
- **Re-derives wallet ownership from the database**, not from the quote's frozen snapshot —
  a wallet unlinked, or re-verified to a different account, after the quote was created can
  no longer be used to submit against it. See [Authorization](#authorization).
- **Verifies the transaction matches the quote** wherever that can already be decided — see
  [Transaction integrity](#transaction-integrity) above.
- Is **idempotent** on both `quoteId` (`@unique`) and `(chainId, txHash)` (`@@unique`) — a
  client retry (a flaky response, a duplicated click) returns the existing row rather than
  erroring or creating a second record. The `(chainId, txHash)` race is caught via Prisma's
  `P2002` and resolved by re-reading the row that won.
- `status` always starts at `PENDING` from the schema default — there is no field a client
  can set to claim a different starting status.

## Idempotency

Nowhere in the trading or wallet-ownership flow does an HTTP retry (a flaky connection, a
double-tapped button, a client's own retry logic) execute something twice:

- **Wallet-challenge consumption** (`WalletService#verifyChallenge`) flips
  `WalletChallenge.usedAt` via a conditional `updateMany` keyed on `usedAt: null` — a
  concurrent second attempt sees `count === 0` and is rejected, rather than both callers
  successfully linking the wallet.
- **Transaction submission** (`TransactionService#submitTransaction`, above) is idempotent
  on both `TradeQuote.id` (via `TradeTransaction.quoteId`'s `@unique`) and
  `(chainId, txHash)` (`@@unique`) — either a repeated call with the same quote or two
  concurrent calls racing to record the same broadcast hash converge on one row, never two.
- **Follows/likes** (Phase 2, unchanged) already established this pattern with a `P2002`-as-
  success handler; Phase 3's transaction path extends it to a case with *two* independent
  uniqueness constraints instead of one, since a retry could plausibly collide on either.

## Transaction lifecycle

```text
PENDING  →  CONFIRMED   (a real receipt with status "success" AND the on-chain tx matches the quote)
         →  FAILED      (a real receipt with status "reverted",
                          OR a successful receipt that does NOT match the quote — see #transaction-integrity)
         →  EXPIRED      (no receipt after TRADING_DEFAULTS.pendingTransactionTimeoutMinutes, 30 min)
```

Two independent, idempotent paths move a transaction out of `PENDING`, both running the same
checks (`TransactionService#refreshStatus` and the independent equivalent in
`apps/workers/src/trading/sweep.ts` — see [Transaction integrity](#transaction-integrity)
for why the sweep isn't a lesser-checked backdoor around the same gate):

1. **On-demand**: `GET /trade/transactions/:id` refreshes a still-`PENDING` row before
   returning it, so a user actively watching a trade sees it confirm promptly.
2. **Background sweep**: `apps/workers/src/trading/sweep.ts#TradeSweepService`, ticking
   every `TRADE_SWEEP_INTERVAL_SECONDS` (default 30s), resolves trades nobody is actively
   watching — a closed tab, a backgrounded submission — so `PENDING` never lingers forever
   for those. A single row's RPC failure never aborts the rest of the batch.

**Never marks `CONFIRMED` because a wallet returned a hash, and never merely because a
receipt says "success."** A status only ever changes in response to a real
`eth_getTransactionReceipt` call (`EvmChainDataProvider#getTransactionReceiptStatus`,
`packages/chain-adapters`) — conflating "not yet mined" and "an RPC hiccup" into the same
`null` deliberately, never fabricating a status when it genuinely doesn't know one — and,
for the specific CONFIRMED transition, a further real on-chain read
(`getTransactionDetails`) confirming the transaction's sender/destination/value/calldata
actually match the persisted quote. A receipt that says "success" but fails that match
becomes FAILED, not CONFIRMED and not PENDING — see
[Transaction integrity](#transaction-integrity).

## Trade history

`GET /trade/history?cursor=&limit=` (`TransactionService#getHistory`) is **always** scoped
to `req.user.id` from the verified JWT — there is no `?userId=` parameter anywhere in the
request shape, and the API's global `ValidationPipe` (`whitelist: true,
forbidNonWhitelisted: true`) rejects an unrecognized query param outright rather than
silently ignoring an attempted override. Cursor-paginated the same way Phase 2's feeds are
(`createdAt DESC, id DESC` keyset, base64url-encoded cursor) — never offset pagination.
Public blockchain activity remains publicly visible through the existing Phase 2 social
system regardless; this endpoint is specifically the caller's own **private** trade record
(fee amounts, exact input amounts, submission timestamps) layered on top of that public
data, not a replacement for it.

## Authorization

Every private trading endpoint follows the same chain: **JWT → authenticated user →
verified wallet ownership → allowed wallet for this operation.**

1. `JwtAuthGuard` establishes `req.user.id` from a signature-checked, still-valid session
   token (Phase 2 infrastructure, unchanged).
2. The service layer re-derives wallet ownership from the database on every call
   (`wallet.userId === req.user.id && wallet.verifiedAt !== null`) — see
   [Wallet ownership](#wallet-ownership). A `walletAddress` in a request body is an input to
   validate, never a claim to trust.
3. Every mutation and read that's inherently personal (quotes, transaction submission,
   transaction detail, trade history) scopes its query to `req.user.id` — there is no
   endpoint in this module that accepts a `userId` from the client, and no query that joins
   across users.

This is a deliberately **stricter** posture than Phase 2's social layer, which is
intentionally public (anyone can view any trader's activity). Trading is inherently tied to
one person's funds and history, so nothing here is meant to be publicly browsable —
contrast `apps/api/src/trading/trading.controller.ts`'s class-level `@UseGuards(JwtAuthGuard)`
(everything requires a session) with `apps/api/src/social`'s per-route `OptionalAuthGuard`.

## Indexer integration

**This is the part of Phase 3 most worth reading carefully.** Fomo never creates a second,
"successful trade" social-activity record when a trade confirms. The only thing that ever
produces a Phase 2 activity item is the Phase 1 indexer detecting a real `Swap` event on
Base and writing a `swaps` row (`apps/workers/src/market/ingestion.ts`) — completely
unmodified by Phase 3. A user-executed trade becomes visible in the social feed exactly the
same way any other wallet's trade does: because the chain emitted a Swap event and the
indexer picked it up, not because Fomo's trading subsystem told the social system "a trade
happened."

This is a deliberate separation, not an oversight:

- **Trade status** (`PENDING`/`CONFIRMED`/`FAILED`/`EXPIRED`) is Fomo's own bookkeeping,
  answering "did *this specific* API call's tracked transaction succeed" — it comes from a
  direct `eth_getTransactionReceipt` call, independent of whether or when the indexer's
  swap-scanning tick happens to run.
- **Social activity** answers a different question — "what trading happened on this pool" —
  and is intentionally indexer-only so it can never be spoofed by claiming a trade through
  the API without one actually landing on-chain.

**Known consequence, disclosed rather than hidden:** the aggregator may route a swap through
a different pool than the specific one Phase 1's indexer watches for a given `TokenMarket`
(0x can split or re-route through better-priced liquidity elsewhere). When that happens, the
trade's own status still resolves correctly (the receipt check doesn't care which pool was
used), but the trade may not appear as a distinct activity item pinned to that exact tracked
market/pool — indexed-social-activity pickup is likely, not 100% guaranteed, for every
single trade. This is the same class of disclosed limitation as Phase 2's router-address
trader-attribution heuristic, not a new kind of dishonesty.

## Security

- **Non-custodial by construction** — see [Non-custodial security](#non-custodial-security)
  above; nothing here relaxes it.
- **A client-supplied wallet address is never proof of anything** — see
  [Wallet ownership](#wallet-ownership); every private trading endpoint re-derives ownership
  from the database, never from the request body alone, and never from a quote's frozen
  snapshot at creation time — [Transaction submission](#transaction-submission) re-checks it
  again at submission.
- **No client-asserted user id anywhere** — every trading/wallet endpoint scopes to
  `req.user.id` from the verified JWT, exactly like Phase 2's follow/like mutations.
- **A successful transaction receipt is never, by itself, treated as proof of which trade
  happened** — see [Transaction integrity](#transaction-integrity). An arbitrary or
  unrelated transaction hash — even a real, successful one — can neither be submitted
  against a quote it doesn't match nor ever reach CONFIRMED for one.
- **A stale quote cannot be replayed** — [Transaction submission](#transaction-submission)
  rejects an expired `quoteId` outright, closing off reusing an old quote as a container for
  a later, unrelated transaction hash.
- **All financial math is exact-integer (`bigint`)** — fee amounts, minimum-output amounts,
  and every persisted token amount are raw integer strings; nothing here converts a
  raw on-chain amount to a JS `Number` for storage or comparison (only for *display*
  formatting, after the real value is already known).
- **Every input is validated server-side**: EVM addresses (`@Matches`), amounts (regex +
  `parseUnits`, rejecting non-positive/malformed values), slippage bounds, quote ids
  (`@IsUUID`), transaction hashes (`@Matches` a 32-byte hex pattern) — a malformed value
  never reaches a service method.
- **Trading endpoints are rate-limited** beyond the app-wide default: wallet-challenge
  issuance (10/60s — the tightest, since it's the cheapest thing to spam), quote requests
  and transaction submission (20/60s each) — see `identity.controller.ts` /
  `trading.controller.ts`.
- **Mutations are idempotent** — see [Transaction submission](#transaction-submission) and
  [Wallet ownership](#wallet-ownership)'s atomic nonce consumption; an HTTP retry never
  double-executes anything.
- **Structured logs never carry a raw signature, a private key, or a signed raw
  transaction** — safe log lines are things like "quote created," "trade submitted" (with
  the tx hash, which is public the moment it's broadcast anyway), "trade status changed,"
  and provider latency/failure — never request/response bodies wholesale.

## Observability

`QuoteService`/`ZeroExSwapRouter`/`TransactionService`/`WalletService` log (via
`nestjs-pino`, honoring the existing redaction config): quote creation and provider latency,
quote failures (no-liquidity, malformed response, network error — distinguished in the log
line, never conflated), the slippage-floor rejection path, trade submission and status
transitions, wallet-verification success/failure (address only, never the signature), and
challenge issuance. `apps/workers`' sweep logs per-tick counts (`checked`/`confirmed`/
`failed`/`expired`) and any per-row RPC error without aborting the batch.

## Error handling

Every user-facing failure path returns a real, specific message rather than a raw provider
error or a generic 500: no live quote available (provider down or no liquidity), token not
tradable (untracked/stale/illiquid — with the specific reason), quote expired, wallet not
verified, quote/wallet mismatch, malformed transaction hash, unique-constraint races
resolved transparently (see idempotency above). The web client
(`TradePanel`'s `friendlyError`) additionally prefers viem/wagmi's own `shortMessage` (e.g.
"User rejected the request") over a raw stack-shaped error string when the wallet itself
throws — a rejected signature is shown as a plain, expected outcome, not treated as an
application error.

## Trading UI

`TradePanel` (`apps/web/components/trading/TradePanel.tsx`) is the one shared trade flow
every entry point opens — the token page's Buy/Sell buttons and an activity card's new
"Trade" action both render the same component, never a bespoke per-page implementation
(`TradeButton`/`TradeModal` are the shared trigger/shell). States, in order: **connect
wallet → verify wallet ownership → form** (side, amount with real on-chain balance presets,
slippage) **→ quoting → review** (or **quote expired**, if the countdown lapses before
"Confirm & sign") **→ [approving, if needed] → wallet signing → submitted → pending →
confirmed / failed**. There is no "one-tap" path that skips Review or Confirm, and no state
ever shows a success indicator before a real on-chain receipt says so.

Trade history (`/trades`) and transaction detail (`/trades/:id`, with fee/price/status/a
correct-chain Basescan link) are both client-rendered — trade history is personal to
whatever session/wallet a browser has, which a Server Component structurally cannot see
(same reasoning as Phase 2's Following feed).

## Known limitations

- **The 0x adapter was written without live verification against a real API key** in this
  environment — see [Provider](#provider). Field names should be re-checked against 0x's
  current docs before depending on this in production; if 0x has changed its Allowance-
  Holder response shape, `parseZeroExQuote` will correctly return `null` (an honest "no
  quote") rather than silently misparsing, but that's a worse user experience than it
  should be.
- **Wallet-ownership verification is EOA-only** — `verifyEvmSignature` doesn't check
  ERC-1271, so a smart-contract wallet (a Safe, some smart-account setups) will fail
  verification even when it does legitimately control the address. Disclosed, not silent:
  the endpoint returns 401, not a false "verified."
- **Indexed social-activity pickup for a Fomo-executed trade is not guaranteed** — see
  [Indexer integration](#indexer-integration). Trade status itself is never affected by
  this; only whether the trade also shows up as a feed item tied to a specific tracked pool.
- **The submission-time transaction-integrity check is best-effort, not a guarantee** — see
  [Transaction integrity](#transaction-integrity). A transaction that hasn't yet propagated
  to Fomo's configured RPC at the moment of submission can't be checked at that instant; it
  is instead checked, authoritatively, the moment it's actually mined (before any CONFIRMED
  transition). This means a mismatched hash could very briefly exist as a `PENDING` row
  before resolving to `FAILED` — it can never reach `CONFIRMED` regardless — a deliberate
  tradeoff of a small, bounded window of "not yet checked" over rejecting a legitimate,
  freshly-broadcast transaction that simply hasn't propagated everywhere yet.
- **No background job resolves a transaction stuck in an ambiguous receipt state beyond the
  documented 30-minute timeout** — after that, it's marked `EXPIRED` even if it eventually
  confirms very late on a congested network. This trades a small amount of correctness in an
  edge case for a bounded, predictable UI state; a genuinely confirmed-but-marked-expired
  transaction is still discoverable on-chain via its recorded hash.
- **No live database/Redis was available in the sandbox this phase was built in** — the
  wallet-ownership and trading e2e suite (`apps/api/test/trading.e2e-spec.ts`) is written
  and typechecked but not locally executed; it runs against real Postgres+Redis service
  containers in CI, following the same pattern already established for
  `market.e2e-spec.ts`/`social.e2e-spec.ts`. See `docs/TESTING.md`.
- **Real ECDSA signatures, real Base-mainnet RPC reads, but never a real funded trade** in
  automated tests — unit and e2e tests use fresh, never-funded keypairs and mocked/CI-
  placeholder provider responses; nothing in this repository's test suite performs a
  destructive real-money swap. A quote request against 0x with CI's placeholder API key
  correctly 401s upstream, which the router turns into an honest `422`, not a crash — the
  e2e suite asserts exactly that as the expected behavior.

## Security assumptions

- The connected wallet software itself is trusted to correctly display what it's signing —
  Fomo cannot prevent a compromised wallet extension from lying to its own user, only
  ensure it always sends the wallet the *true* transaction it intends to have signed.
- 0x's Allowance-Holder contract is trusted to execute the swap and fee split as
  configured. [Transaction integrity](#transaction-integrity)'s calldata match proves the
  transaction that succeeded is byte-for-byte the one 0x prepared for this exact quote
  (amounts, minimum output, and fee split all encoded in that calldata) — Fomo does not
  additionally decode ERC-20 `Transfer` logs from the receipt to independently re-derive the
  amounts actually received. A successful receipt for that exact, matched calldata is
  trusted to mean 0x's own contract logic enforced its encoded minimum-output constraint;
  Fomo does not re-implement or re-verify that enforcement itself.
- The configured `CHAIN_RPC_URL` is trusted for receipt lookups; a malicious or compromised
  RPC endpoint could theoretically misreport a transaction's status. This is the same trust
  boundary Phase 1's ingestion already accepts for reading swap events.
