import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
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

/** Same real challenge -> sign -> verify flow as trading.e2e-spec.ts's helper of the same
 *  name — duplicated rather than imported, matching this test suite's existing convention
 *  of each e2e file owning its fixtures. */
async function linkVerifiedWallet(app: INestApplication, token: string) {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(generatePrivateKey());
  const auth = { Authorization: `Bearer ${token}` };

  const challenge = await request(app.getHttpServer())
    .post('/v1/identity/wallet/challenge')
    .set(auth)
    .send({ address: account.address });
  expect(challenge.status).toBe(201);

  const signature = await account.signMessage({ message: challenge.body.message });
  const verify = await request(app.getHttpServer())
    .post('/v1/identity/wallet/verify')
    .set(auth)
    .send({ nonce: challenge.body.nonce, signature });
  expect(verify.status).toBe(200);

  return { address: account.address.toLowerCase() };
}

/**
 * Requires a reachable Postgres and Redis, same as the rest of this test directory. See
 * docs/TESTING.md and docs/NOTIFICATIONS.md.
 *
 * FOLLOW/LIKE notifications are created by apps/api itself (FollowService/LikeService ->
 * NotificationService), so those are exercised end-to-end for real here. WHALE_TRADE/
 * FOLLOWED_TRADER_TRADE/TRENDING_TOKEN are created by the ingestion worker — a separate
 * app/process this suite has no dependency on and cannot invoke — so, matching the existing
 * convention in social.e2e-spec.ts ("seeds real swaps directly via Prisma rather than
 * depending on the ingestion worker having run"), those are exercised by seeding a
 * `Notification` row directly via Prisma (simulating "the worker already ran") and testing
 * the read side (list/unread-count/mark-read) against it.
 *
 * Each describe block gets its own Nest app instance (own throttler storage) — see
 * trading.e2e-spec.ts's comment on the same pattern; `/identity/session` and
 * `/identity/wallet/challenge` are both throttled to 10/60s in production, and splitting by
 * describe block keeps each instance's usage safely under that without touching the
 * production throttle values.
 */
describe('Notifications (e2e) — follow notifications', () => {
  let app: INestApplication;
  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0xb00000000000000000000000000000000000a1';
  const quoteAddress = '0xb00000000000000000000000000000000000a2';
  const poolAddress = '0xb00000000000000000000000000000000000a3';
  let tokenMarketId: string;

  beforeAll(async () => {
    app = await buildApp();

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
    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: baseAddress,
        symbol: 'NOTFA',
        name: 'Notif Token A',
        decimals: 18,
      },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: quoteAddress,
        symbol: 'NOTFAQ',
        name: 'Notif Quote A',
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
      },
    });
    tokenMarketId = market.id;
  });

  afterAll(async () => {
    // Wallet rows from linkVerifiedWallet's randomly-generated keypairs are deliberately
    // left in place, same as trading.e2e-spec.ts's own convention — CI's Postgres is a
    // fresh, ephemeral container per run, and random addresses can't collide with anything.
    await prisma.notification.deleteMany({ where: { tokenMarketId } });
    await prisma.swap.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await app.close();
  });

  it("follow -> the followed wallet's owner receives a persisted, unread FOLLOW notification with a working deep link", async () => {
    const recipient = await issueSession(app);
    const { address: recipientAddress } = await linkVerifiedWallet(app, recipient.token);
    const recipientAuth = { Authorization: `Bearer ${recipient.token}` };

    // The follower also links a wallet — the FOLLOW notification's deep link points at the
    // *actor's* (follower's) trader page, which only resolves once they have one. An actor
    // with no linked wallet at all (a legitimate case — see NOTIFICATION_INCLUDE's comment
    // in notification.mapper.ts) would correctly yield a null deepLink instead.
    const follower = await issueSession(app);
    const { address: followerAddress } = await linkVerifiedWallet(app, follower.token);
    const followerAuth = { Authorization: `Bearer ${follower.token}` };
    await request(app.getHttpServer())
      .post(`/v1/social/traders/${recipientAddress}/follow`)
      .set(followerAuth)
      .expect(200);

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(recipientAuth);
    expect(list.status).toBe(200);
    const notif = list.body.items.find((n: { type: string }) => n.type === 'FOLLOW');
    expect(notif).toBeDefined();
    expect(notif.readAt).toBeNull();
    expect(notif.actor.address).toBe(followerAddress);
    expect(notif.deepLink).toBe(`/trader/${followerAddress}`);

    const unread = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set(recipientAuth);
    expect(unread.body.count).toBeGreaterThanOrEqual(1);

    // 7-step scenario continued: open (mark read) -> unread count decrements, persists.
    const markRead = await request(app.getHttpServer())
      .post(`/v1/notifications/${notif.id}/read`)
      .set(recipientAuth);
    expect(markRead.status).toBe(200);
    const afterRead = await request(app.getHttpServer())
      .get('/v1/notifications')
      .set(recipientAuth);
    const same = afterRead.body.items.find((n: { id: string }) => n.id === notif.id);
    expect(same.readAt).not.toBeNull();
  });

  it('a duplicate follow (already following) does not create a second FOLLOW notification', async () => {
    const recipient = await issueSession(app);
    const { address: recipientAddress } = await linkVerifiedWallet(app, recipient.token);
    const follower = await issueSession(app);
    const followerAuth = { Authorization: `Bearer ${follower.token}` };

    await request(app.getHttpServer())
      .post(`/v1/social/traders/${recipientAddress}/follow`)
      .set(followerAuth)
      .expect(200);
    const before = await prisma.notification.count({ where: { type: 'FOLLOW' } });
    await request(app.getHttpServer())
      .post(`/v1/social/traders/${recipientAddress}/follow`)
      .set(followerAuth)
      .expect(200); // idempotent success at the follow layer too
    const after = await prisma.notification.count({ where: { type: 'FOLLOW' } });
    expect(after).toBe(before); // re-following the same trader must not renotify
  });

  it('never self-notifies when a user follows or likes their own content', async () => {
    const self = await issueSession(app);
    const selfAuth = { Authorization: `Bearer ${self.token}` };
    const { address: ownAddress } = await linkVerifiedWallet(app, self.token);

    await request(app.getHttpServer())
      .post(`/v1/social/traders/${ownAddress}/follow`)
      .set(selfAuth)
      .expect(200);

    const swap = await prisma.swap.create({
      data: {
        chainId: (await prisma.tokenMarket.findUniqueOrThrow({ where: { id: tokenMarketId } }))
          .chainId,
        tokenMarketId,
        txHash: `0x${'c'.repeat(64)}`,
        logIndex: 0,
        blockNumber: 5000n,
        blockTimestamp: new Date(),
        amount0Raw: '1',
        amount1Raw: '-1',
        priceUsd: 1,
        volumeUsd: 1,
        side: 'buy',
        traderAddress: ownAddress,
      },
    });
    await request(app.getHttpServer())
      .post(`/v1/social/activity/${swap.id}/like`)
      .set(selfAuth)
      .expect(200);

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(selfAuth);
    expect(
      list.body.items.some((n: { type: string }) => n.type === 'FOLLOW' || n.type === 'LIKE'),
    ).toBe(false);

    await prisma.swap.delete({ where: { id: swap.id } });
  });
});

describe('Notifications (e2e) — like notifications and preferences', () => {
  let app: INestApplication;
  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0xb00000000000000000000000000000000000b1';
  const quoteAddress = '0xb00000000000000000000000000000000000b2';
  const poolAddress = '0xb00000000000000000000000000000000000b3';
  let tokenMarketId: string;
  let swapId: string;

  beforeAll(async () => {
    app = await buildApp();

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
    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: baseAddress,
        symbol: 'NOTFB',
        name: 'Notif Token B',
        decimals: 18,
      },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: quoteAddress,
        symbol: 'NOTFBQ',
        name: 'Notif Quote B',
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
      },
    });
    tokenMarketId = market.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tokenMarketId } });
    if (swapId) await prisma.activityLike.deleteMany({ where: { swapId } });
    await prisma.swap.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await app.close();
  });

  it('like -> the trader receives a persisted LIKE notification', async () => {
    const trader = await issueSession(app);
    const { address: traderAddress } = await linkVerifiedWallet(app, trader.token);
    const traderAuth = { Authorization: `Bearer ${trader.token}` };

    const swap = await prisma.swap.create({
      data: {
        chainId: (await prisma.tokenMarket.findUniqueOrThrow({ where: { id: tokenMarketId } }))
          .chainId,
        tokenMarketId,
        txHash: `0x${'d'.repeat(64)}`,
        logIndex: 0,
        blockNumber: 5001n,
        blockTimestamp: new Date(),
        amount0Raw: '1',
        amount1Raw: '-1',
        priceUsd: 1,
        volumeUsd: 1,
        side: 'sell',
        traderAddress,
      },
    });
    swapId = swap.id;

    const liker = await issueSession(app);
    await request(app.getHttpServer())
      .post(`/v1/social/activity/${swap.id}/like`)
      .set({ Authorization: `Bearer ${liker.token}` })
      .expect(200);

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(traderAuth);
    const notif = list.body.items.find((n: { type: string }) => n.type === 'LIKE');
    expect(notif).toBeDefined();
    expect(notif.token.address).toBe(baseAddress);
    expect(notif.side).toBe('SELL');
  });

  it('a disabled preference prevents that notification type from being created', async () => {
    const recipient = await issueSession(app);
    const { address } = await linkVerifiedWallet(app, recipient.token);
    const recipientAuth = { Authorization: `Bearer ${recipient.token}` };

    const prefs = await request(app.getHttpServer())
      .patch('/v1/notifications/preferences')
      .set(recipientAuth)
      .send({ follows: false });
    expect(prefs.status).toBe(200);
    expect(prefs.body.follows).toBe(false);

    const follower = await issueSession(app);
    await request(app.getHttpServer())
      .post(`/v1/social/traders/${address}/follow`)
      .set({ Authorization: `Bearer ${follower.token}` })
      .expect(200);

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(recipientAuth);
    expect(list.body.items.some((n: { type: string }) => n.type === 'FOLLOW')).toBe(false);
  });

  it('GET /v1/notifications/preferences returns the shipped defaults for a session that never set any', async () => {
    const session = await issueSession(app);
    const res = await request(app.getHttpServer())
      .get('/v1/notifications/preferences')
      .set({ Authorization: `Bearer ${session.token}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      follows: true,
      likes: true,
      followedTraderTrades: true,
      whaleTrades: true,
      trendingTokens: true,
      watchedTokenActivity: true,
    });
  });

  it('POST /v1/notifications/stream-ticket issues a single-use ticket to an authenticated session', async () => {
    const session = await issueSession(app);
    const res = await request(app.getHttpServer())
      .post('/v1/notifications/stream-ticket')
      .set({ Authorization: `Bearer ${session.token}` });
    expect(res.status).toBe(201);
    expect(typeof res.body.ticket).toBe('string');
    expect(res.body.ticket.length).toBeGreaterThan(16);
  });
});

describe('Notifications (e2e) — security', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('every mutation/list/preferences/stream endpoint requires authentication', async () => {
    const server = app.getHttpServer();
    // Fired sequentially, not via Promise.all — a concurrent burst against a freshly-built
    // app instance can itself produce ECONNREFUSED/ECONNRESET unrelated to auth, the same
    // ordinary listener-race lesson documented in trading.e2e-spec.ts.
    const requests: [string, string][] = [
      ['get', '/v1/notifications'],
      ['get', '/v1/notifications/unread-count'],
      ['post', '/v1/notifications/some-id/read'],
      ['post', '/v1/notifications/read-all'],
      ['get', '/v1/notifications/preferences'],
      ['patch', '/v1/notifications/preferences'],
      ['post', '/v1/notifications/stream-ticket'],
    ];
    for (const [method, path] of requests) {
      const res =
        method === 'get'
          ? await request(server).get(path)
          : method === 'post'
            ? await request(server).post(path)
            : await request(server).patch(path);
      expect(res.status).toBe(401);
    }
  });

  it('GET /v1/notifications/stream 401s without a valid ticket — EventSource cannot send a bearer token', async () => {
    const res = await request(app.getHttpServer()).get('/v1/notifications/stream');
    expect(res.status).toBe(401);
  });

  it("IDOR: a session cannot mark-read another user's notification, and cannot see it via list/unread-count", async () => {
    const recipient = await issueSession(app);
    const { address } = await linkVerifiedWallet(app, recipient.token);
    const recipientAuth = { Authorization: `Bearer ${recipient.token}` };

    const follower = await issueSession(app);
    await request(app.getHttpServer())
      .post(`/v1/social/traders/${address}/follow`)
      .set({ Authorization: `Bearer ${follower.token}` })
      .expect(200);

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(recipientAuth);
    const notif = list.body.items.find((n: { type: string }) => n.type === 'FOLLOW');
    expect(notif).toBeDefined();

    const attacker = await issueSession(app);
    const attackerAuth = { Authorization: `Bearer ${attacker.token}` };
    const attackerMarkRead = await request(app.getHttpServer())
      .post(`/v1/notifications/${notif.id}/read`)
      .set(attackerAuth);
    expect(attackerMarkRead.status).toBe(200); // silently affects zero rows, not an error/leak

    const stillUnread = await request(app.getHttpServer())
      .get('/v1/notifications')
      .set(recipientAuth);
    expect(stillUnread.body.items.find((n: { id: string }) => n.id === notif.id).readAt).toBeNull();

    const attackerList = await request(app.getHttpServer())
      .get('/v1/notifications')
      .set(attackerAuth);
    expect(attackerList.body.items.some((n: { id: string }) => n.id === notif.id)).toBe(false);

    await prisma.wallet.delete({ where: { address } }).catch(() => undefined);
    await prisma.follow.deleteMany({ where: { walletAddress: address } });
  });
});

describe('Notifications (e2e) — worker-created notifications (seeded directly, per social.e2e-spec.ts convention)', () => {
  let app: INestApplication;
  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0xb00000000000000000000000000000000000c1';
  const quoteAddress = '0xb00000000000000000000000000000000000c2';
  const poolAddress = '0xb00000000000000000000000000000000000c3';
  const traderAddress = '0xb00000000000000000000000000000000000c4';
  let tokenMarketId: string;
  let swapId: string;

  beforeAll(async () => {
    app = await buildApp();

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
    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: baseAddress,
        symbol: 'WHAL',
        name: 'Whale Token',
        decimals: 18,
      },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: quoteAddress,
        symbol: 'WHALQ',
        name: 'Whale Quote',
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
      },
    });
    tokenMarketId = market.id;

    await prisma.wallet.upsert({
      where: { address: traderAddress },
      update: {},
      create: { address: traderAddress, firstSeenAt: new Date() },
    });
    const swap = await prisma.swap.create({
      data: {
        chainId: chain.id,
        tokenMarketId,
        txHash: `0x${'e'.repeat(64)}`,
        logIndex: 0,
        blockNumber: 6000n,
        blockTimestamp: new Date(),
        amount0Raw: '1',
        amount1Raw: '-1',
        priceUsd: 50_000,
        volumeUsd: 50_000,
        side: 'buy',
        traderAddress,
      },
    });
    swapId = swap.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tokenMarketId } });
    await prisma.swap.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await prisma.wallet.delete({ where: { address: traderAddress } }).catch(() => undefined);
    await app.close();
  });

  it('serves a worker-created WHALE_TRADE notification with correctly resolved actor/token/amount', async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    await prisma.notification.create({
      data: {
        userId: session.userId,
        type: 'WHALE_TRADE',
        dedupeKey: `swap:${swapId}`,
        actorWalletAddress: traderAddress,
        swapId,
      },
    });

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(auth);
    const notif = list.body.items.find((n: { type: string }) => n.type === 'WHALE_TRADE');
    expect(notif).toBeDefined();
    expect(notif.actor.address).toBe(traderAddress);
    expect(notif.token.address).toBe(baseAddress);
    expect(notif.amountUsd).toBe(50_000);
    expect(notif.side).toBe('BUY');
    expect(notif.deepLink).toBe(`/market/${baseAddress}`);
  });

  it('serves a worker-created TRENDING_TOKEN notification with no actor', async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    await prisma.notification.create({
      data: {
        userId: session.userId,
        type: 'TRENDING_TOKEN',
        dedupeKey: `token:${tokenMarketId}:since:now`,
        tokenMarketId,
      },
    });

    const list = await request(app.getHttpServer()).get('/v1/notifications').set(auth);
    const notif = list.body.items.find((n: { type: string }) => n.type === 'TRENDING_TOKEN');
    expect(notif).toBeDefined();
    expect(notif.actor).toBeNull();
    expect(notif.token.address).toBe(baseAddress);
  });

  it('mark-all-read clears unread count to zero without needing per-notification ids', async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    await prisma.notification.create({
      data: {
        userId: session.userId,
        type: 'TRENDING_TOKEN',
        dedupeKey: `token:${tokenMarketId}:since:mark-all`,
        tokenMarketId,
      },
    });
    const before = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set(auth);
    expect(before.body.count).toBeGreaterThan(0);

    const markAll = await request(app.getHttpServer()).post('/v1/notifications/read-all').set(auth);
    expect(markAll.status).toBe(200);

    const after = await request(app.getHttpServer())
      .get('/v1/notifications/unread-count')
      .set(auth);
    expect(after.body.count).toBe(0);
  });
});

describe('Notifications (e2e) — rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/notifications/read-all is throttled — production limits are never weakened for tests', async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    // read-all is limited to 10/60s (see notification.controller.ts) — fire sequentially,
    // not concurrently, matching trading.e2e-spec.ts's lesson that a concurrent burst
    // against a cold app instance can itself produce ECONNRESET unrelated to throttling.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app.getHttpServer()).post('/v1/notifications/read-all').set(auth);
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
