import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestApp } from './test-app';

/**
 * Requires a reachable Postgres (DATABASE_URL) and Redis (REDIS_URL) — same as
 * market.e2e-spec.ts. Seeds a market, a trader wallet, and real swaps directly via Prisma
 * rather than depending on the ingestion worker having run. See docs/TESTING.md.
 */
describe('Social (e2e)', () => {
  let app: INestApplication;

  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0x4200000000000000000000000000000000000006';
  const quoteAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const poolAddress = '0x6c561B446416E1A00E8E93E221854d6eA4171372';
  const traderAddress = '0x1111111111111111111111111111111111aaaa';
  const untrackedWallet = '0x000000000000000000000000000000000000dEaD';

  let tokenMarketId: string;
  const swapIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createTestApp(moduleRef);

    const chain = await prisma.chain.upsert({
      where: { identifier: chainIdentifier },
      update: {},
      create: { identifier: chainIdentifier, name: 'Base', nativeSymbol: 'ETH', rpcConfigKey: 'CHAIN_RPC_URL' },
    });
    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
      update: {},
      create: { chainId: chain.id, contractAddress: baseAddress, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: { chainId: chain.id, contractAddress: quoteAddress, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
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
        priceUsd: 2455.23,
        liquidityUsd: 117_566_374,
        volume24hUsd: 24_500_000,
        tradeCount24h: 50,
        uniqueTraders24h: 10,
        priceChange24hPct: 1.06,
        lastPriceUpdateAt: new Date(),
      },
    });
    tokenMarketId = market.id;

    await prisma.wallet.upsert({
      where: { address: traderAddress },
      update: {},
      create: { address: traderAddress, firstSeenAt: new Date(Date.now() - 3600_000) },
    });

    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const swap = await prisma.swap.create({
        data: {
          chainId: chain.id,
          tokenMarketId,
          txHash: `0x${'a'.repeat(63)}${i}`,
          logIndex: i,
          blockNumber: BigInt(1000 + i),
          blockTimestamp: new Date(now - i * 60_000),
          amount0Raw: '1000000000000000000',
          amount1Raw: '-2455230000',
          priceUsd: 2455.23,
          volumeUsd: 1000 + i,
          side: i % 2 === 0 ? 'buy' : 'sell',
          traderAddress,
          senderAddress: traderAddress,
        },
      });
      swapIds.push(swap.id);
    }
  });

  afterAll(async () => {
    await prisma.activityLike.deleteMany({ where: { swapId: { in: swapIds } } });
    await prisma.follow.deleteMany({ where: { walletAddress: traderAddress } });
    await prisma.swap.deleteMany({ where: { tokenMarketId } });
    await prisma.candle.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await prisma.wallet.delete({ where: { address: traderAddress } }).catch(() => undefined);
    await app.close();
  });

  async function issueSession(): Promise<string> {
    const res = await request(app.getHttpServer()).post('/v1/identity/session');
    expect(res.status).toBe(201);
    return res.body.token as string;
  }

  it('POST /v1/identity/session issues a usable bearer token', async () => {
    const res = await request(app.getHttpServer()).post('/v1/identity/session');
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.userId).toBe('string');
  });

  it('GET /v1/social/activity returns the seeded swaps, newest first, with no fabricated fields', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/activity?limit=10');
    expect(res.status).toBe(200);
    const mine = res.body.items.filter((a: { trader: { address: string } }) => a.trader.address === traderAddress);
    expect(mine.length).toBe(3);
    expect(mine[0].action).toBe('BUY'); // most recent (i=0) was a buy
    expect(mine[0].social).toEqual({ likes: 0, likedByMe: null }); // unauthenticated caller
    expect(mine[0].trader.displayName).toBeNull(); // never fabricated
  });

  it('GET /v1/social/activity paginates with a stable cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v1/social/activity?limit=1&tokenAddress=' + baseAddress);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await request(app.getHttpServer()).get(
      `/v1/social/activity?limit=1&tokenAddress=${baseAddress}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('GET /v1/social/activity treats a malformed cursor as "start over", not a 400', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/activity?cursor=%25%25garbage%25%25');
    expect(res.status).toBe(200);
  });

  it('GET /v1/social/traders/:address returns real, computable stats only', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/social/traders/${traderAddress}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.totalSwaps).toBe(3);
    expect(res.body.stats.buyCount).toBe(2);
    expect(res.body.stats.sellCount).toBe(1);
    expect(res.body.followerCount).toBe(0);
    expect(res.body).not.toHaveProperty('pnl');
    expect(res.body).not.toHaveProperty('roi');
  });

  it('GET /v1/social/traders/:address returns 404 for a wallet that has never traded', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/social/traders/${untrackedWallet}`);
    expect(res.status).toBe(404);
  });

  it('GET /v1/social/traders/:address returns 400 for a malformed address', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/traders/not-an-address');
    expect(res.status).toBe(400);
  });

  it('POST /v1/social/traders/:address/follow requires authentication', async () => {
    const res = await request(app.getHttpServer()).post(`/v1/social/traders/${traderAddress}/follow`);
    expect(res.status).toBe(401);
  });

  it('POST /v1/social/traders/:address/follow rejects following a wallet that has never traded', async () => {
    const token = await issueSession();
    const res = await request(app.getHttpServer())
      .post(`/v1/social/traders/${untrackedWallet}/follow`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('follow -> profile reflects isFollowedByMe -> duplicate follow is idempotent -> unfollow clears it', async () => {
    const token = await issueSession();
    const auth = { Authorization: `Bearer ${token}` };

    const follow1 = await request(app.getHttpServer()).post(`/v1/social/traders/${traderAddress}/follow`).set(auth);
    expect(follow1.status).toBe(200);

    const follow2 = await request(app.getHttpServer()).post(`/v1/social/traders/${traderAddress}/follow`).set(auth);
    expect(follow2.status).toBe(200); // duplicate — idempotent, not a 409/500

    const profile = await request(app.getHttpServer()).get(`/v1/social/traders/${traderAddress}`).set(auth);
    expect(profile.body.isFollowedByMe).toBe(true);
    expect(profile.body.followerCount).toBe(1);

    const unfollow = await request(app.getHttpServer()).delete(`/v1/social/traders/${traderAddress}/follow`).set(auth);
    expect(unfollow.status).toBe(200);

    const profileAfter = await request(app.getHttpServer()).get(`/v1/social/traders/${traderAddress}`).set(auth);
    expect(profileAfter.body.isFollowedByMe).toBe(false);
    expect(profileAfter.body.followerCount).toBe(0);
  });

  it("a follow made by one session is not visible as another session's isFollowedByMe", async () => {
    const tokenA = await issueSession();
    const tokenB = await issueSession();
    await request(app.getHttpServer())
      .post(`/v1/social/traders/${traderAddress}/follow`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const asB = await request(app.getHttpServer())
      .get(`/v1/social/traders/${traderAddress}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(asB.body.isFollowedByMe).toBe(false);

    await request(app.getHttpServer())
      .delete(`/v1/social/traders/${traderAddress}/follow`)
      .set('Authorization', `Bearer ${tokenA}`);
  });

  it('GET /v1/social/activity/following requires authentication', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/activity/following');
    expect(res.status).toBe(401);
  });

  it('GET /v1/social/activity/following returns activity only from followed traders', async () => {
    const token = await issueSession();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app.getHttpServer()).post(`/v1/social/traders/${traderAddress}/follow`).set(auth);

    const res = await request(app.getHttpServer()).get('/v1/social/activity/following').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((a: { trader: { address: string } }) => a.trader.address === traderAddress)).toBe(true);

    await request(app.getHttpServer()).delete(`/v1/social/traders/${traderAddress}/follow`).set(auth);
  });

  it('GET /v1/social/activity/following is empty for a session following no one', async () => {
    const token = await issueSession();
    const res = await request(app.getHttpServer())
      .get('/v1/social/activity/following')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('POST /v1/social/activity/:id/like requires authentication', async () => {
    const res = await request(app.getHttpServer()).post(`/v1/social/activity/${swapIds[0]}/like`);
    expect(res.status).toBe(401);
  });

  it('like -> activity reflects the count -> duplicate like is idempotent -> unlike clears it', async () => {
    const token = await issueSession();
    const auth = { Authorization: `Bearer ${token}` };

    await request(app.getHttpServer()).post(`/v1/social/activity/${swapIds[0]}/like`).set(auth).expect(200);
    await request(app.getHttpServer()).post(`/v1/social/activity/${swapIds[0]}/like`).set(auth).expect(200); // idempotent

    const feed = await request(app.getHttpServer()).get(`/v1/social/activity?tokenAddress=${baseAddress}`).set(auth);
    const liked = feed.body.items.find((a: { id: string }) => a.id === swapIds[0]);
    expect(liked.social).toEqual({ likes: 1, likedByMe: true });

    await request(app.getHttpServer()).delete(`/v1/social/activity/${swapIds[0]}/like`).set(auth).expect(200);
    const feedAfter = await request(app.getHttpServer()).get(`/v1/social/activity?tokenAddress=${baseAddress}`).set(auth);
    const unliked = feedAfter.body.items.find((a: { id: string }) => a.id === swapIds[0]);
    expect(unliked.social).toEqual({ likes: 0, likedByMe: false });
  });

  it('POST /v1/social/activity/:id/like returns 404 for a non-existent activity id', async () => {
    const token = await issueSession();
    const res = await request(app.getHttpServer())
      .post('/v1/social/activity/00000000-0000-0000-0000-000000000000/like')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('GET /v1/social/trending surfaces the seeded market once it clears every threshold', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/trending');
    expect(res.status).toBe(200);
    const seeded = res.body.find((t: { market: { tokenAddress: string } }) => t.market.tokenAddress === baseAddress);
    expect(seeded).toBeDefined();
    expect(typeof seeded.trendingScore).toBe('number');
  });

  it('GET /v1/social/traders/top ranks the seeded trader by real 24h volume, never claiming profit', async () => {
    const res = await request(app.getHttpServer()).get('/v1/social/traders/top');
    expect(res.status).toBe(200);
    const seeded = res.body.find((t: { address: string }) => t.address === traderAddress);
    expect(seeded).toBeDefined(); // 3 seeded trades clears the minimum-trade-count floor
    expect(typeof seeded.volumeUsd).toBe('number');
    expect(seeded).not.toHaveProperty('pnl');
    expect(seeded).not.toHaveProperty('roi');
  });

  it('GET /v1/social/traders/search finds the seeded trader by address prefix', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/social/traders/search?q=${traderAddress.slice(0, 10)}`);
    expect(res.status).toBe(200);
    expect(res.body.some((t: { address: string }) => t.address === traderAddress)).toBe(true);
  });
});
