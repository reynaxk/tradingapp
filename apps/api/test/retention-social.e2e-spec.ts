import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
import { MAX_SAVED_SEARCHES_PER_USER } from '@fomo/domain';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestApp } from './test-app';

async function buildApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  return createTestApp(moduleRef);
}

async function issueSession(app: INestApplication): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer()).post('/v1/identity/session');
  expect(res.status).toBe(201);
  return { token: res.body.token as string, userId: res.body.userId as string };
}

/**
 * Deterministic, always exactly `0x` + 40 hex chars — hand-typed hex literals have caused
 * address-length and mixed-case bugs in earlier phases (see docs/TESTING.md), so every
 * address in this file is generated this way instead of typed out. Always lowercase, which
 * matters for Wallet rows (looked up by exact primary-key match, never case-insensitive).
 *
 * Hashed, not just hex-encoded: a plain `Buffer.from(seed).toString('hex')` truncated to 40
 * chars only reflects the seed's first 20 characters, so two seeds sharing a >20-char common
 * prefix (e.g. "watchlist-personalization-watched" vs "...-plain") would silently collide
 * into the *same* address. SHA-256 makes the entire seed affect every output byte.
 */
function testAddress(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 40);
  return `0x${hex}`;
}

async function seedMarket(
  chainIdentifier: string,
  seed: string,
  symbol: string,
  overrides: Record<string, unknown> = {},
) {
  const chain = await prisma.chain.upsert({
    where: { identifier: chainIdentifier },
    update: {},
    create: {
      identifier: chainIdentifier,
      name: 'Base',
      nativeSymbol: 'ETH',
      rpcConfigKey: 'CHAIN_RPC_URL',
    },
  });
  const baseAddress = testAddress(`${seed}-base`);
  const quoteAddress = testAddress(`${seed}-quote`);
  const poolAddress = testAddress(`${seed}-pool`);

  const baseToken = await prisma.token.upsert({
    where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
    update: {},
    create: { chainId: chain.id, contractAddress: baseAddress, symbol, name: symbol, decimals: 18 },
  });
  const quoteToken = await prisma.token.upsert({
    where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
    update: {},
    create: {
      chainId: chain.id,
      contractAddress: quoteAddress,
      symbol: `${symbol}Q`,
      name: `${symbol}Q`,
      decimals: 6,
    },
  });
  const market = await prisma.tokenMarket.upsert({
    where: { chainId_pairAddress: { chainId: chain.id, pairAddress: poolAddress } },
    update: {},
    create: {
      chainId: chain.id,
      tokenId: baseToken.id,
      quoteTokenId: quoteToken.id,
      dex: 'uniswap-v3',
      pairAddress: poolAddress,
      feeTier: 3000,
      ...overrides,
    },
  });
  return { marketId: market.id, baseAddress, chainId: chain.id };
}

/**
 * Phase 6 — see docs/PHASE6_RETENTION_SOCIAL.md. Requires a reachable Postgres and Redis,
 * same as the rest of this test directory. `WATCHED_TOKEN_ACTIVITY` is created by the
 * ingestion worker (apps/workers), a separate process this suite cannot invoke — matching
 * the existing convention in notifications.e2e-spec.ts, that type is exercised by seeding a
 * `Notification` row directly via Prisma (simulating "the worker already ran") and testing
 * the read side; the fan-out threshold/cooldown/dedupe logic itself is covered by
 * apps/workers' own unit tests. Each describe block gets its own Nest app instance (own
 * throttler storage) — `/identity/session` is throttled 10/60s in production, and splitting
 * by describe block keeps each instance's usage safely under that.
 */
describe('Watchlist (e2e) — CRUD, idempotency, cross-user isolation', () => {
  let app: INestApplication;
  let marketId: string;
  let tokenAddress: string;

  beforeAll(async () => {
    app = await buildApp();
    const seeded = await seedMarket('eip155:8453', 'watchlist-crud', 'WLA');
    marketId = seeded.marketId;
    tokenAddress = seeded.baseAddress;
  });

  afterAll(async () => {
    await prisma.tokenWatch.deleteMany({ where: { tokenMarketId: marketId } });
    await prisma.tokenMarket.delete({ where: { id: marketId } }).catch(() => undefined);
    await app.close();
  });

  it('GET watch status is null (not false) for an unauthenticated caller', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/market/tokens/${tokenAddress}/watch`);
    expect(res.status).toBe(200);
    expect(res.body.watching).toBeNull();
  });

  it('watch -> appears in the watchlist -> watching again is duplicate-safe -> unwatch removes it', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    const watch = await request(server).post(`/v1/market/tokens/${tokenAddress}/watch`).set(auth);
    expect(watch.status).toBe(200);
    expect(watch.body).toEqual({ watching: true });

    const status = await request(server).get(`/v1/market/tokens/${tokenAddress}/watch`).set(auth);
    expect(status.body.watching).toBe(true);

    const list = await request(server).get('/v1/social/watchlist').set(auth);
    expect(list.status).toBe(200);
    expect(
      list.body.items.some((i: { tokenAddress: string }) => i.tokenAddress === tokenAddress),
    ).toBe(true);

    // Idempotent: watching an already-watched token is a success, not an error, and never
    // produces a second row.
    const watchAgain = await request(server)
      .post(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(auth);
    expect(watchAgain.status).toBe(200);
    const rowCount = await prisma.tokenWatch.count({
      where: { userId: user.userId, tokenMarketId: marketId },
    });
    expect(rowCount).toBe(1);

    const unwatch = await request(server)
      .delete(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(auth);
    expect(unwatch.status).toBe(200);
    expect(unwatch.body).toEqual({ watching: false });

    const statusAfter = await request(server)
      .get(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(auth);
    expect(statusAfter.body.watching).toBe(false);

    // Idempotent unwatch: unwatching an already-unwatched token is still a success.
    const unwatchAgain = await request(server)
      .delete(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(auth);
    expect(unwatchAgain.status).toBe(200);
  });

  it("cross-user isolation: one user's watchlist never contains another user's watch, and cannot be modified by them (IDOR)", async () => {
    const owner = await issueSession(app);
    const other = await issueSession(app);
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const server = app.getHttpServer();

    await request(server)
      .post(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(ownerAuth)
      .expect(200);

    const otherList = await request(server).get('/v1/social/watchlist').set(otherAuth);
    expect(otherList.status).toBe(200);
    expect(
      otherList.body.items.some((i: { tokenAddress: string }) => i.tokenAddress === tokenAddress),
    ).toBe(false);

    // "Unwatching" from the other user's own session can only ever affect their own
    // (nonexistent) watch — the owner's row must survive untouched.
    await request(server)
      .delete(`/v1/market/tokens/${tokenAddress}/watch`)
      .set(otherAuth)
      .expect(200);
    const ownerStillWatching = await prisma.tokenWatch.findUnique({
      where: { userId_tokenMarketId: { userId: owner.userId, tokenMarketId: marketId } },
    });
    expect(ownerStillWatching).not.toBeNull();

    await prisma.tokenWatch.deleteMany({
      where: { userId: owner.userId, tokenMarketId: marketId },
    });
  });

  it('mutations require authentication', async () => {
    const server = app.getHttpServer();
    expect((await request(server).post(`/v1/market/tokens/${tokenAddress}/watch`)).status).toBe(
      401,
    );
    expect((await request(server).delete(`/v1/market/tokens/${tokenAddress}/watch`)).status).toBe(
      401,
    );
    expect((await request(server).get('/v1/social/watchlist')).status).toBe(401);
  });

  it('watching an unknown token address 404s rather than silently succeeding', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const unknown = testAddress('never-tracked-token');
    const res = await request(app.getHttpServer())
      .post(`/v1/market/tokens/${unknown}/watch`)
      .set(auth);
    expect(res.status).toBe(404);
  });
});

describe('Saved searches (e2e) — CRUD, per-user cap, IDOR', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('create -> list -> delete, scoped to the caller alone', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    const create = await request(server)
      .post('/v1/discovery/saved-searches')
      .set(auth)
      .send({ query: 'pepe', displayName: 'My pepe search' });
    expect(create.status).toBe(201);
    expect(create.body.query).toBe('pepe');
    expect(create.body.displayName).toBe('My pepe search');

    const list = await request(server).get('/v1/discovery/saved-searches').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.some((s: { id: string }) => s.id === create.body.id)).toBe(true);

    const del = await request(server)
      .delete(`/v1/discovery/saved-searches/${create.body.id}`)
      .set(auth);
    expect(del.status).toBe(200);

    const listAfter = await request(server).get('/v1/discovery/saved-searches').set(auth);
    expect(listAfter.body.some((s: { id: string }) => s.id === create.body.id)).toBe(false);
  });

  it('rejects an empty or whitespace-only query', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    expect(
      (await request(server).post('/v1/discovery/saved-searches').set(auth).send({ query: '' }))
        .status,
    ).toBe(400);
    expect(
      (await request(server).post('/v1/discovery/saved-searches').set(auth).send({ query: '   ' }))
        .status,
    ).toBe(400);
  });

  it(`enforces the documented per-user cap of ${MAX_SAVED_SEARCHES_PER_USER}`, async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    for (let i = 0; i < MAX_SAVED_SEARCHES_PER_USER; i++) {
      const res = await request(server)
        .post('/v1/discovery/saved-searches')
        .set(auth)
        .send({ query: `search-${i}` });
      expect(res.status).toBe(201);
    }

    const overCap = await request(server)
      .post('/v1/discovery/saved-searches')
      .set(auth)
      .send({ query: 'one-too-many' });
    expect(overCap.status).toBe(400);

    const list = await request(server).get('/v1/discovery/saved-searches').set(auth);
    expect(list.body).toHaveLength(MAX_SAVED_SEARCHES_PER_USER);
  });

  it("IDOR: another user's saved search cannot be deleted, and their list never shows it", async () => {
    const owner = await issueSession(app);
    const other = await issueSession(app);
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const server = app.getHttpServer();

    const create = await request(server)
      .post('/v1/discovery/saved-searches')
      .set(ownerAuth)
      .send({ query: 'owners-search' });
    expect(create.status).toBe(201);

    const otherList = await request(server).get('/v1/discovery/saved-searches').set(otherAuth);
    expect(otherList.body.some((s: { id: string }) => s.id === create.body.id)).toBe(false);

    // Reports success (idempotent-delete convention) without actually removing the owner's row.
    await request(server)
      .delete(`/v1/discovery/saved-searches/${create.body.id}`)
      .set(otherAuth)
      .expect(200);
    const ownerListAfter = await request(server).get('/v1/discovery/saved-searches').set(ownerAuth);
    expect(ownerListAfter.body.some((s: { id: string }) => s.id === create.body.id)).toBe(true);
  });

  it('mutations and reads require authentication', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/v1/discovery/saved-searches')).status).toBe(401);
    expect(
      (await request(server).post('/v1/discovery/saved-searches').send({ query: 'x' })).status,
    ).toBe(401);
    expect((await request(server).delete('/v1/discovery/saved-searches/some-id')).status).toBe(401);
  });
});

describe('Return loop (e2e) — what you missed & streak', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a brand-new user has nothing missed and no streak yet', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const res = await request(app.getHttpServer()).get('/v1/discovery/whats-missed').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.totalUnseen).toBe(0);
    expect(res.body.currentStreakDays).toBe(0);
  });

  it("what's missed reflects real persisted notifications, and mark-seen starts a streak and clears the count", async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    await prisma.notification.create({
      data: { userId: user.userId, type: 'FOLLOW', dedupeKey: `e2e-return-loop:${user.userId}` },
    });

    const missed = await request(server).get('/v1/discovery/whats-missed').set(auth);
    expect(missed.status).toBe(200);
    expect(missed.body.totalUnseen).toBeGreaterThanOrEqual(1);

    const seen = await request(server).post('/v1/discovery/mark-seen').set(auth);
    expect(seen.status).toBe(200);
    expect(seen.body.currentStreakDays).toBe(1);
    expect(seen.body.longestStreakDays).toBe(1);

    const missedAfter = await request(server).get('/v1/discovery/whats-missed').set(auth);
    expect(missedAfter.body.totalUnseen).toBe(0);

    // A second mark-seen on the same UTC day never double-counts the streak.
    const seenAgain = await request(server).post('/v1/discovery/mark-seen').set(auth);
    expect(seenAgain.body.currentStreakDays).toBe(1);
  });

  it('reads and mutations require authentication', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/v1/discovery/whats-missed')).status).toBe(401);
    expect((await request(server).post('/v1/discovery/mark-seen')).status).toBe(401);
  });
});

describe('Watched-token notification integration (e2e) — read side', () => {
  let app: INestApplication;
  let marketId: string;
  let tokenAddress: string;

  beforeAll(async () => {
    app = await buildApp();
    const seeded = await seedMarket('eip155:8453', 'watched-notif', 'WNA');
    marketId = seeded.marketId;
    tokenAddress = seeded.baseAddress;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tokenMarketId: marketId } });
    await prisma.tokenWatch.deleteMany({ where: { tokenMarketId: marketId } });
    await prisma.tokenMarket.delete({ where: { id: marketId } }).catch(() => undefined);
    await app.close();
  });

  it('the watchedTokenActivity preference defaults to enabled and can be toggled like every other preference', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    const prefs = await request(server).get('/v1/notifications/preferences').set(auth);
    expect(prefs.status).toBe(200);
    expect(prefs.body.watchedTokenActivity).toBe(true);

    const updated = await request(server)
      .patch('/v1/notifications/preferences')
      .set(auth)
      .send({ watchedTokenActivity: false });
    expect(updated.status).toBe(200);
    expect(updated.body.watchedTokenActivity).toBe(false);
  });

  it(
    'a WATCHED_TOKEN_ACTIVITY row (as the worker would create it) lists correctly with a working deep link — ' +
      'the fan-out threshold/cooldown/dedupe logic itself is unit-tested in apps/workers',
    async () => {
      const user = await issueSession(app);
      const auth = { Authorization: `Bearer ${user.token}` };
      const server = app.getHttpServer();

      await request(server).post(`/v1/market/tokens/${tokenAddress}/watch`).set(auth).expect(200);

      await prisma.notification.create({
        data: {
          userId: user.userId,
          type: 'WATCHED_TOKEN_ACTIVITY',
          dedupeKey: `e2e-watched:${user.userId}`,
          tokenMarketId: marketId,
        },
      });

      const list = await request(server).get('/v1/notifications').set(auth);
      expect(list.status).toBe(200);
      const notif = list.body.items.find(
        (n: { type: string }) => n.type === 'WATCHED_TOKEN_ACTIVITY',
      );
      expect(notif).toBeDefined();
      expect(notif.token.address).toBe(tokenAddress);
      expect(notif.deepLink).toBe(`/market/${tokenAddress}`);
    },
  );
});

describe('Personalization (e2e) — reflects the watchlist signal', () => {
  let app: INestApplication;
  let watchedMarketId: string;
  let watchedAddress: string;
  let plainMarketId: string;
  let plainAddress: string;

  const marketProfile = {
    liquidityUsd: 100_000,
    volume24hUsd: 50_000,
    priceChange24hPct: 3,
    lastPriceUpdateAt: new Date(),
  };

  beforeAll(async () => {
    app = await buildApp();
    const watched = await seedMarket(
      'eip155:8453',
      'watchlist-personalization-watched',
      'WPW',
      marketProfile,
    );
    const plain = await seedMarket(
      'eip155:8453',
      'watchlist-personalization-plain',
      'WPP',
      marketProfile,
    );
    watchedMarketId = watched.marketId;
    watchedAddress = watched.baseAddress;
    plainMarketId = plain.marketId;
    plainAddress = plain.baseAddress;
  });

  afterAll(async () => {
    await prisma.tokenWatch.deleteMany({
      where: { tokenMarketId: { in: [watchedMarketId, plainMarketId] } },
    });
    await prisma.tokenMarket.deleteMany({
      where: { id: { in: [watchedMarketId, plainMarketId] } },
    });
    await app.close();
  });

  it('a watched token appears in personalized discovery with a "You\'re watching this token" reason', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    await request(server).post(`/v1/market/tokens/${watchedAddress}/watch`).set(auth).expect(200);

    const res = await request(server).get('/v1/discovery/personalized?limit=50').set(auth);
    expect(res.status).toBe(200);
    const item = res.body.find(
      (p: { market: { tokenAddress: string } }) => p.market.tokenAddress === watchedAddress,
    );
    expect(item).toBeDefined();
    expect(item.reasons).toContain("You're watching this token");
  });

  it('boosts a watched token over an otherwise-identical unwatched one, by exactly the watchlist weight — never an unbounded jump', async () => {
    const user = await issueSession(app);
    const auth = { Authorization: `Bearer ${user.token}` };
    const server = app.getHttpServer();

    await request(server).post(`/v1/market/tokens/${watchedAddress}/watch`).set(auth).expect(200);

    const res = await request(server).get('/v1/discovery/personalized?limit=50').set(auth);
    const watchedItem = res.body.find(
      (p: { market: { tokenAddress: string } }) => p.market.tokenAddress === watchedAddress,
    );
    const plainItem = res.body.find(
      (p: { market: { tokenAddress: string } }) => p.market.tokenAddress === plainAddress,
    );
    expect(watchedItem).toBeDefined();
    expect(plainItem).toBeDefined();
    expect(plainItem.reasons).not.toContain("You're watching this token");
    // Same underlying market profile, no other personal signal on either — the entire
    // difference is the watchlist weight (0.25), not an outsized or unbounded jump.
    expect(watchedItem.score - plainItem.score).toBeCloseTo(0.25, 5);
  });
});
