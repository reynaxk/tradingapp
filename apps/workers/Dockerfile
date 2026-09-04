# syntax=docker/dockerfile:1
# Build context is the REPO ROOT: docker build -f apps/workers/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
RUN npx turbo prune @fomo/workers --docker

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@fomo/workers

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fomo
USER fomo

COPY --from=builder --chown=fomo:nodejs /app .

ENV NODE_ENV=production

CMD ["node", "apps/workers/dist/main.js"]
