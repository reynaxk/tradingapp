# Deployment

Matches the approved architecture: managed, usage-priced infrastructure, no Kubernetes,
no self-managed nodes at this stage.

| Piece | Target | Why |
| --- | --- | --- |
| `apps/web` | Vercel | Zero-config Next.js hosting with edge caching for public pages. |
| `apps/api` | Fly.io (or Railway) | Container hosting for a long-running Nest process; `apps/api/Dockerfile` builds it. |
| `apps/workers` | Fly.io (or Railway), separate app/machine from the API | Independently deployable and independently scalable from request-serving — see the architecture spec. `apps/workers/Dockerfile` builds it. |
| Postgres | Neon | Managed Postgres with the Timescale extension available; branching is convenient for a small team. |
| Redis | Upstash | Serverless, usage-priced, no server to operate. |

## Web (Vercel)

1. Import the repository into Vercel.
2. Root Directory: `apps/web`. Vercel auto-detects the monorepo via `turbo.json` and only
   needs the app's own build command (`next build`) — no custom install command required
   as long as the project uses pnpm (Vercel detects `pnpm-lock.yaml` automatically).
3. No environment variables are required yet (see `apps/web/.env.example`).

## API and workers (Fly.io)

Each app deploys as its own Fly app, built from its own Dockerfile with the **repo root**
as build context:

```bash
fly launch --dockerfile apps/api/Dockerfile --name <api-app-name> --no-deploy
fly launch --dockerfile apps/workers/Dockerfile --name <workers-app-name> --no-deploy
```

Set secrets per app (never commit these — see `apps/api/.env.example` and
`apps/workers/.env.example` for the full list each one needs):

```bash
fly secrets set -a <api-app-name> DATABASE_URL=... REDIS_URL=... CORS_ORIGIN=...
fly secrets set -a <workers-app-name> DATABASE_URL=... REDIS_URL=... CHAIN_RPC_URL=... \
  CHAIN_IDENTIFIER=eip155:8453 CHAIN_NAME=Base CHAIN_NATIVE_SYMBOL=ETH
```

Then:

```bash
fly deploy -a <api-app-name> --dockerfile apps/api/Dockerfile
fly deploy -a <workers-app-name> --dockerfile apps/workers/Dockerfile
```

The API's health check (`GET /health`) is what Fly (or any platform's health check
config) should poll — it verifies both the database and Redis are reachable, not just
that the process is up.

## Database and Redis (Neon / Upstash)

1. Create a Neon Postgres project; enable the `timescaledb` extension (Neon supports it —
   check the current list of supported extensions if this ever changes) or point
   `DATABASE_URL` at any Postgres 16 instance with `timescaledb` installed.
2. Run the migration against it once: `DATABASE_URL=... pnpm --filter @fomo/db migrate:deploy`.
3. Create an Upstash Redis database and use its connection string as `REDIS_URL`.

## What Phase 0 does NOT do

It does not provision any of the above automatically — that requires accounts and
credentials only the project owner has. This document is the runbook; running it against
real accounts is a manual step outside this repository.
