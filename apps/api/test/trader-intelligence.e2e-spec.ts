import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
import { LARGE_TRADE_USD_THRESHOLD } from '@fomo/domain';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestApp } from './test-app';

async function buildApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  return createTestApp(moduleRef);
}

async function issueSession(app: INestApplication): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer()).post('/v1/identity/session');
  expect(res.status).toBe(201);
  return { token: res.body.token as string, userId: res.body.userId as string };
}

/** Same real challenge -> sign -> verify flow as the other e2e files' helper of the same name. */
async function linkVerifiedWallet(app: INestApplication, token: string) {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(generatePrivateKey());
  const auth = { Authorization: `Bearer ${token}` };

  const challenge = await request(app.getHttpServer()).post('/v1/identity/wallet/challenge').set(auth).send({ address: account.address });
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
 * Phase 5 — see docs/TRADER_INTELLIGENCE.md. Requires a reachable Postgres and Redis, same
 * as the rest of this test directory. Every ranking/stat here is exercised against real
 * seeded `swaps` rows (never a client-provided trade history) — see docs/TESTING.md.
 */
describe('Trader intelligence & discovery (e2e) — public reads', () => {
  let app: INestApplication;
  const chainIdentifier = 'eip155:8453';
  const tokenA = { base: '0xc000000000000000000000000000000000000a01', quote: '0xc000000000000000000000000000000000000a02', pool: '0xc000000000000000000000000000000000000a03' };
  const tokenB = { base: '0xc000000000000000000000000000000000000b01', quote: '0xc000000000000000000000000000000000000b02', pool: '0xc000000000000000000000000000000000000b03' };
  // Lowercase, deliberately — Wallet.address is looked up by exact primary-key match after
  // the API normalizes an incoming address param to lowercase (see normalizeEvmAddress in
  // @fomo/domain); a mixed-case literal here would insert a row the endpoint could never find.
  const traderAddress = '0xc00000000000000000000000000000000000dead';
  let marketAId: string;
  let marketBId: string;
  const swapIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();

    const chain = await prisma.chain.upsert({
      where: { identifier: chainIdentifier },
      update: {},
      create: { identifier: chainIdentifier, name: 'Base', nativeSymbol: 'ETH', rpcConfigKey: 'CHAIN_RPC_URL' },
    });
    async function seedMarket(t: { base: string; quote: string; pool: string }, symbol: string) {
      const baseToken = await prisma.token.upsert({
        where: { chainId_contractAddress: { chainId: chain.id, contractAddress: t.base } },
        update: {},
        create: { chainId: chain.id, contractAddress: t.base, symbol, name: symbol, decimals: 18 },
      });
      const quoteToken = await prisma.token.upsert({
        where: { chainId_contractAddress: { chainId: chain.id, contractAddress: t.quote } },
        update: {},
        create: { chainId: chain.id, contractAddress: t.quote, symbol: `${symbol}Q`, name: `${symbol}Q`, decimals: 6 },
      });
      const market = await prisma.tokenMarket.upsert({
        where: { chainId_pairAddress: { chainId: chain.id, pairAddress: t.pool } },
        update: {},
        create: {
          chainId: chain.id,
          tokenId: baseToken.id,
          quoteTokenId: quoteToken.id,
          dex: 'uniswap-v3',
          pairAddress: t.pool,
          feeTier: 3000,
          liquidityUsd: 100_000,
          volume24hUsd: 50_000,
          uniqueTraders24h: 5,
          tradeCount24h: 10,
        },
      });
      return market.id;
    }

    marketAId = await seedMarket(tokenA, 'TIA');
    marketBId = await seedMarket(tokenB, 'TIB');

    await prisma.wallet.upsert({
      where: { address: traderAddress },
      update: {},
      create: { address: traderAddress, firstSeenAt: new Date(Date.now() - 5 * 86_400_000) },
    });

    // Trades across BOTH markets so uniqueTokensTraded/concentration have something real to
    // measure, plus one large trade (>= LARGE_TRADE_USD_THRESHOLD) on market A.
    const now = Date.now();
    const rows = [
      { tokenMarketId: marketAId, txHash: `0x${'1'.repeat(63)}0`, volumeUsd: LARGE_TRADE_USD_THRESHOLD + 1000, side: 'buy', offsetMs: 0 },
      { tokenMarketId: marketAId, txHash: `0x${'1'.repeat(63)}1`, volumeUsd: 100, side: 'sell', offsetMs: 60_000 },
      { tokenMarketId: marketBId, txHash: `0x${'1'.repeat(63)}2`, volumeUsd: 200, side: 'buy', offsetMs: 120_000 },
    ];
    for (const [i, r] of rows.entries()) {
      const swap = await prisma.swap.create({
        data: {
          chainId: chain.id,
          tokenMarketId: r.tokenMarketId,
          txHash: r.txHash,
          logIndex: 0,
          blockNumber: BigInt(9000 + i),
          blockTimestamp: new Date(now - r.offsetMs),
          amount0Raw: '1',
          amount1Raw: '-1',
          priceUsd: 1,
          volumeUsd: r.volumeUsd,
          side: r.side,
          traderAddress,
        },
      });
      swapIds.push(swap.id);
    }
  });

  afterAll(async () => {
    await prisma.swap.deleteMany({ where: { id: { in: swapIds } } });
    await prisma.tokenMarket.deleteMany({ where: { id: { in: [marketAId, marketBId] } } });
    await prisma.wallet.delete({ where: { address: traderAddress } }).catch(() => undefined);
    await app.close();
  });

  it('GET /v1/social/traders/:address returns richer stats derived only from indexed swaps', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/social/traders/${traderAddress}`);
    expect(res.status).toBe(200);
    const { stats } = res.body;
    expect(stats.totalSwaps).toBe(3);
    expect(stats.uniqueTokensTraded).toBe(2);
    expect(stats.largestTradeUsd).toBe(LARGE_TRADE_USD_THRESHOLD + 1000);
    expect(stats.avgTradeSizeUsd).toBeCloseTo((LARGE_TRADE_USD_THRESHOLD + 1000 + 100 + 200) / 3, 5);
    expect(stats.buyRatio).toBeCloseTo(2 / 3, 5);
    expect(stats.concentrationIndex).toBeGreaterThan(0);
    expect(stats.concentrationIndex).toBeLessThanOrEqual(1);
    // The hard principle — never a fabricated performance metric.
    expect(res.body).not.toHaveProperty('pnl');
    expect(res.body).not.toHaveProperty('roi');
    expect(res.body).not.toHaveProperty('winRate');
    expect(stats).not.toHaveProperty('pnl');
  });

  it('GET /v1/social/traders/:address/tokens aggregates per token, ordered by volume', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/social/traders/${traderAddress}/tokens`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].token.address).toBe(tokenA.base); // higher combined volume than token B
    expect(res.body[0].tradeCount).toBe(2);
  });

  it('GET /v1/market/tokens/:address/traders exposes recent/active traders and large trades for that token', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/market/tokens/${tokenA.base}/traders`);
    expect(res.status).toBe(200);
    expect(res.body.recentTraders.some((t: { address: string }) => t.address === traderAddress)).toBe(true);
    expect(res.body.recentLargeTrades).toHaveLength(1);
    expect(res.body.recentLargeTrades[0].amountUsd).toBeGreaterThanOrEqual(LARGE_TRADE_USD_THRESHOLD);
    expect(typeof res.body.uniqueTraders24h === 'number' || res.body.uniqueTraders24h === null).toBe(true);
  });

  it('GET /v1/discovery/large-trades surfaces the seeded whale-sized swap', async () => {
    const res = await request(app.getHttpServer()).get('/v1/discovery/large-trades?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.some((a: { txHash: string }) => a.txHash === `0x${'1'.repeat(63)}0`)).toBe(true);
    expect(res.body.every((a: { amountUsd: number }) => a.amountUsd >= LARGE_TRADE_USD_THRESHOLD)).toBe(true);
  });

  it('GET /v1/discovery/active-traders never claims profitability', async () => {
    const res = await request(app.getHttpServer()).get('/v1/discovery/active-traders?limit=50');
    expect(res.status).toBe(200);
    for (const trader of res.body) {
      expect(trader).not.toHaveProperty('pnl');
      expect(trader).not.toHaveProperty('winRate');
      expect(trader).not.toHaveProperty('roi');
    }
  });

  it('GET /v1/discovery/rising returns a well-formed { tokens, traders } shape', async () => {
    const res = await request(app.getHttpServer()).get('/v1/discovery/rising?limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tokens)).toBe(true);
    expect(Array.isArray(res.body.traders)).toBe(true);
  });

  it('personalized discovery/feed require authentication', async () => {
    const server = app.getHttpServer();
    const a = await request(server).get('/v1/discovery/personalized');
    expect(a.status).toBe(401);
    const b = await request(server).get('/v1/discovery/feed');
    expect(b.status).toBe(401);
  });
});

describe('Trader intelligence & discovery (e2e) — personalized', () => {
  let app: INestApplication;
  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0xc000000000000000000000000000000000000c01';
  const quoteAddress = '0xc000000000000000000000000000000000000c02';
  const poolAddress = '0xc000000000000000000000000000000000000c03';
  let tokenMarketId: string;
  const swapIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();

    const chain = await prisma.chain.upsert({
      where: { identifier: chainIdentifier },
      update: {},
      create: { identifier: chainIdentifier, name: 'Base', nativeSymbol: 'ETH', rpcConfigKey: 'CHAIN_RPC_URL' },
    });
    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: baseAddress } },
      update: {},
      create: { chainId: chain.id, contractAddress: baseAddress, symbol: 'PERS', name: 'Personalized', decimals: 18 },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: { chainId: chain.id, contractAddress: quoteAddress, symbol: 'PERSQ', name: 'PersQ', decimals: 6 },
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
        liquidityUsd: 100_000,
        volume24hUsd: 50_000,
        priceChange24hPct: 2,
        lastPriceUpdateAt: new Date(),
      },
    });
    tokenMarketId = market.id;
  });

  afterAll(async () => {
    await prisma.swap.deleteMany({ where: { id: { in: swapIds } } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await app.close();
  });

  it('1. user follows trader -> 2. trader has confirmed indexed activity -> 5. follower sees personalized activity with an explanation', async () => {
    const follower = await issueSession(app);
    const followerAuth = { Authorization: `Bearer ${follower.token}` };
    const trader = await issueSession(app);
    const { address: traderAddress } = await linkVerifiedWallet(app, trader.token);

    await request(app.getHttpServer()).post(`/v1/social/traders/${traderAddress}/follow`).set(followerAuth).expect(200);

    const swap = await prisma.swap.create({
      data: {
        chainId: (await prisma.tokenMarket.findUniqueOrThrow({ where: { id: tokenMarketId } })).chainId,
        tokenMarketId,
        txHash: `0x${'2'.repeat(64)}`,
        logIndex: 0,
        blockNumber: 9500n,
        blockTimestamp: new Date(),
        amount0Raw: '1',
        amount1Raw: '-1',
        priceUsd: 1,
        volumeUsd: 500,
        side: 'buy',
        traderAddress,
      },
    });
    swapIds.push(swap.id);

    const feed = await request(app.getHttpServer()).get('/v1/discovery/feed?limit=20').set(followerAuth);
    expect(feed.status).toBe(200);
    const item = feed.body.items.find((i: { activity: { id: string } }) => i.activity.id === swap.id);
    expect(item).toBeDefined();
    expect(item.reasonCode).toBe('FOLLOWED_TRADER');
    // linkVerifiedWallet only proves ownership via signature — it never sets a displayName,
    // so the reason correctly falls back to the generic phrasing (see feedReasonText in
    // @fomo/domain) rather than naming a trader Fomo has no real display identity for.
    expect(item.reason).toBe('From a trader you follow');

    const discovery = await request(app.getHttpServer()).get('/v1/discovery/personalized?limit=20').set(followerAuth);
    expect(discovery.status).toBe(200);
    const personalizedEntry = discovery.body.find((p: { market: { tokenAddress: string } }) => p.market.tokenAddress === baseAddress);
    expect(personalizedEntry).toBeDefined();
    expect(personalizedEntry.reasons.length).toBeGreaterThan(0);
    for (const reason of personalizedEntry.reasons) {
      expect(reason.toLowerCase()).not.toMatch(/ai picked|smart money|alpha/);
    }
  });

  it('7. pagination works for the personalized feed', async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    const first = await request(app.getHttpServer()).get('/v1/discovery/feed?limit=1').set(auth);
    expect(first.status).toBe(200);
    if (first.body.nextCursor) {
      const second = await request(app.getHttpServer())
        .get(`/v1/discovery/feed?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .set(auth);
      expect(second.status).toBe(200);
      if (first.body.items[0] && second.body.items[0]) {
        expect(second.body.items[0].activity.id).not.toBe(first.body.items[0].activity.id);
      }
    }
  });

  it("8. a session with no follows sees only general discovery — never another session's personalized view", async () => {
    const session = await issueSession(app);
    const auth = { Authorization: `Bearer ${session.token}` };

    const feed = await request(app.getHttpServer()).get('/v1/discovery/feed?limit=20').set(auth);
    expect(feed.status).toBe(200);
    expect(feed.body.items.every((i: { reasonCode: string }) => i.reasonCode === 'GENERAL_DISCOVERY')).toBe(true);
  });
});
