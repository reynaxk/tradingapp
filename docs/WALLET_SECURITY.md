# Wallet security principles

## Non-custodial, by construction

This backend is never in a position to move a user's funds — not because it's trained not
to, but because it structurally cannot:

- **No private keys are ever stored anywhere** — not in the database, not in a queue
  payload, not in a log line, not in an environment variable.
- **No seed phrases are ever collected, transmitted, or stored.**
- **The server never signs a transaction on a user's behalf.** Signing happens exclusively
  in the user's own wallet (browser extension, mobile wallet, or WalletConnect session).
  `apps/api`'s future `TradingModule` (Phase 3) will build unsigned transactions and hand
  them to the client — it will never hold a signing key.

If a future change ever appears to require server-side signing or key storage, that is a
signal the design is wrong, not a signal to add a secrets vault for keys. Stop and
reconsider the flow instead.

## Wallet-first identity

A wallet is not a user. The data model (`packages/db/prisma/schema.prisma`'s future
`wallets` table, landing in Phase 2) must support:

```text
Wallet
  ↓
may belong to a User (once someone signs up and links it)

or

Wallet
  ↓
tracked publicly, with no registered User at all
```

Most wallets this platform will ever have data about — including every whale surfaced in
discovery — will never sign up. Modeling the wallet as the primary entity, with the user
link optional, is what makes trader-intelligence features possible without waiting on
registration. See `docs/SOURCE_OF_TRUTH.md` and the architecture spec for the full
`wallets` shape; Phase 0 only needs this principle to not be foreclosed by today's schema,
which it isn't — `chains`/`tokens`/`token_markets` don't reference a `users` table at all.

## Login, when it exists (Phase 2)

Two independent ways in, issuing the same session type so downstream code never branches
on how a session started:

- **Email/passkey**, via a managed auth provider — password handling, MFA, and bot
  protection are a security liability not worth building from scratch.
- **Sign-In With Ethereum (EIP-4361)** — proves wallet ownership via a signed message, not
  a password. Still never touches a private key server-side; the signature is produced by
  the wallet, the server only verifies it.

## What Phase 0 already enforces

- `helmet()` is applied globally in `apps/api/src/main.ts` for secure HTTP defaults.
- CORS is explicit and configured from `CORS_ORIGIN`, not wildcarded.
- A global rate limiter (`@nestjs/throttler`) is wired in from the start — see
  `apps/api/src/app.module.ts` — so every future endpoint is rate-limited by default
  rather than needing someone to remember to add it.
- The global exception filter (`apps/api/src/common/filters/all-exceptions.filter.ts`)
  never echoes an unrecognized error's message or stack to the client in production.
- Structured logs (`nestjs-pino` in the API, `pino` in the worker) redact
  `authorization`/`cookie`/`password`/`secret`/`token`/`privateKey`/`seedPhrase` paths by
  default — see the `redact` config in both `app.module.ts` and
  `apps/workers/src/lib/logger.ts`.
- Every required environment variable is validated at boot (`zod`, via
  `packages/domain`'s `parseEnv`) — a missing secret fails loudly at startup, not silently
  at the point of use.
