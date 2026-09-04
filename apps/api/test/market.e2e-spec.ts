import type { INestApplication} from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Requires a reachable Postgres (DATABASE_URL) and Redis (REDIS_URL) — same as
 * health.e2e-spec.ts. Seeds one real market directly via Prisma (this is a fresh,
 * disposable database in CI) rather than depending on the ingestion worker having run,
 * so this test exercises the API -> database path in isolation. See /docs/TESTING.md.
 */
describe('Market (e2e)', () => {
  let app: INestApplication;

  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0x4200000000000000000000000000000000000006';
  const quoteAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const untrackedAddress = '0x0000000000000000000000000000000000dEaD';
  const poolAddress = '0x6c561B446416E1A00E8E93E221854d6eA4171372';

  let tokenMarketId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's bootstrap — the e2e test module doesn't go through main.ts, so
    // this has to be applied explicitly or DTO validation silently never runs.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();

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
        priceChange24hPct: 1.06,
        lastPriceUpdateAt: new Date(),
      },
    });
    tokenMarketId = market.id;
  });

  afterAll(async () => {
    await prisma.candle.deleteMany({ where: { tokenMarketId } });
    await prisma.swap.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await app.close();
  });

  it('GET /v1/market/discover returns the seeded market with a computed score', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/discover');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    const seeded = response.body.find((m: { tokenAddress: string }) => m.tokenAddress === baseAddress);
    expect(seeded).toBeDefined();
    expect(seeded.symbol).toBe('WETH');
    expect(seeded.priceUsd).toBeCloseTo(2455.23, 2);
    expect(typeof seeded.discoveryScore).toBe('number');
  });

  it('GET /v1/market/discover respects the limit parameter', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/discover?limit=1');
    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(1);
  });

  it('GET /v1/market/discover rejects an out-of-range limit rather than silently clamping it', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/discover?limit=500');
    expect(response.status).toBe(400);
  });

  it('GET /v1/market/tokens/:address returns the seeded market', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/market/tokens/${baseAddress}`);
    expect(response.status).toBe(200);
    expect(response.body.symbol).toBe('WETH');
    expect(response.body.quoteSymbol).toBe('USDC');
    expect(response.body.isStale).toBe(false);
  });

  it('GET /v1/market/tokens/:address is case-insensitive', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/market/tokens/${baseAddress.toLowerCase()}`);
    expect(response.status).toBe(200);
  });

  it('GET /v1/market/tokens/:address returns 404 for a well-formed but untracked address', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/market/tokens/${untrackedAddress}`);
    expect(response.status).toBe(404);
    expect(response.body.message).not.toMatch(/prisma|sql|stack/i);
  });

  it('GET /v1/market/tokens/:address returns 400 for a malformed address, not a leaked internal error', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/tokens/not-an-address');
    expect(response.status).toBe(400);
  });

  it('GET /v1/market/tokens/:address/history returns an honest empty array with no candles yet', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/market/tokens/${baseAddress}/history?timeframe=1D`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /v1/market/tokens/:address/history rejects an invalid timeframe', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/market/tokens/${baseAddress}/history?timeframe=1Y`);
    expect(response.status).toBe(400);
  });

  it('GET /v1/market/search matches by symbol substring, case-insensitively', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/search?q=weth');
    expect(response.status).toBe(200);
    expect(response.body.some((m: { symbol: string }) => m.symbol === 'WETH')).toBe(true);
  });

  it('GET /v1/market/search requires a non-empty query', async () => {
    const response = await request(app.getHttpServer()).get('/v1/market/search?q=');
    expect(response.status).toBe(400);
  });
});
