# syntax=docker/dockerfile:1
# Build context is the REPO ROOT: docker build -f apps/api/Dockerfile .
# Uses Turborepo's `prune` to keep the image to only what @fomo/api actually needs.

FROM node:20-alpine AS base
RUN corepack enable

# ---- Prune the workspace down to @fomo/api's dependency subgraph ----
FROM base AS pruner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
RUN npx turbo prune @fomo/api --docker

# ---- Install deps for the pruned subgraph, then build ----
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@fomo/api

# ---- Minimal runtime image ----
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fomo
USER fomo

COPY --from=builder --chown=fomo:nodejs /app .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
