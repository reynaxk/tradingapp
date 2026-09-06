import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { prisma } from '@fomo/db';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { AppModule } from '../src/app.module';
import { createTestApp } from './test-app';

/**
 * Requires a reachable Postgres (DATABASE_URL) and Redis (REDIS_URL), same as
 * market.e2e-spec.ts / social.e2e-spec.ts. CI runs this against a real Base RPC and the
 * real 0x API using a placeholder key (see .github/workflows/ci.yml) — this deliberately
 * never fabricates a quote to work around that: a request that would need a real quote
 * asserts the honest 422 failure path instead. Wallet ownership is exercised with real
 * ECDSA signatures (fresh keypairs, never funded, never reused across tests) — never
 * mocked — so this is the one place proving the actual crypto, not a stand-in for it.
 * See docs/TESTING.md.
 */
describe('Trading (e2e)', () => {
  let app: INestApplication;

  // Distinct from market.e2e-spec.ts and social.e2e-spec.ts's fixture addresses — see the
  // comment in social.e2e-spec.ts on why that matters even with maxWorkers: 1.
  const chainIdentifier = 'eip155:8453';
  const baseAddress = '0x888888888888888888888888888888888888e444';
  const quoteAddress = '0x999999999999999999999999999999999999f555';
  const poolAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad666';
  const untrackedTokenAddress = '0x222222222222222222222222222222222222bbbb';

  let tokenMarketId: string;

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
      create: { chainId: chain.id, contractAddress: baseAddress, symbol: 'TRADE', name: 'Trade Test Token', decimals: 18 },
    });
    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: quoteAddress } },
      update: {},
      create: { chainId: chain.id, contractAddress: quoteAddress, symbol: 'TRADEQ', name: 'Trade Test Quote', decimals: 6 },
    });
    const market = await prisma.tokenMarket.upsert({
      where: { chainId_pairAddress: { chainId: chain.id, pairAddress: poolAddress } },
      update: { liquidityUsd: 5_000_000, lastPriceUpdateAt: new Date() },
      create: {
        chainId: chain.id,
        tokenId: baseToken.id,
        quoteTokenId: quoteToken.id,
        dex: 'uniswap-v3',
        pairAddress: poolAddress,
        feeTier: 3000,
        priceUsd: 2.5,
        liquidityUsd: 5_000_000,
        volume24hUsd: 1_000_000,
        priceChange24hPct: 1.2,
        lastPriceUpdateAt: new Date(),
      },
    });
    tokenMarketId = market.id;
  });

  afterAll(async () => {
    await prisma.tradeTransaction.deleteMany({ where: { tokenMarketId } });
    await prisma.tradeQuote.deleteMany({ where: { tokenMarketId } });
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await app.close();
  });

  async function issueSession(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/v1/identity/session');
    expect(res.status).toBe(201);
    return { token: res.body.token as string, userId: res.body.userId as string };
  }

  /** Runs the real challenge -> sign -> verify flow with a fresh, never-funded keypair, so
   *  every trading test that needs "a session with a verified wallet" gets one without
   *  duplicating the crypto plumbing. */
  async function linkVerifiedWallet(token: string) {
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

    return { account, address: account.address.toLowerCase() };
  }

  async function seedQuote(userId: string, walletAddress: string, overrides: Partial<Record<string, unknown>> = {}) {
    return prisma.tradeQuote.create({
      data: {
        userId,
        walletAddress,
        chainId: 8453,
        side: 'BUY',
        tokenMarketId,
        inputToken: quoteAddress,
        outputToken: baseAddress,
        inputAmount: '1000000',
        expectedOutputAmount: '100000000000000000000',
        minOutputAmount: '99500000000000000000',
        slippageBps: 50,
        platformFeeBps: 50,
        platformFeeAmount: '500000000000000000',
        provider: '0x',
        unsignedTx: { to: '0x000000000000000000000000000000deadbeef', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      },
    });
  }

  describe('wallet ownership', () => {
    it('POST /v1/identity/wallet/challenge requires authentication', async () => {
      const res = await request(app.getHttpServer()).post('/v1/identity/wallet/challenge').send({ address: '0x1234567890123456789012345678901234567890' });
      expect(res.status).toBe(401);
    });

    it('challenge -> sign -> verify -> listed -> unlink -> gone', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const auth = { Authorization: `Bearer ${token}` };

      const list = await request(app.getHttpServer()).get('/v1/identity/wallets').set(auth);
      expect(list.status).toBe(200);
      expect(list.body.some((w: { address: string }) => w.address === address)).toBe(true);

      const unlink = await request(app.getHttpServer()).delete(`/v1/identity/wallets/${address}`).set(auth);
      expect(unlink.status).toBe(200);

      const listAfter = await request(app.getHttpServer()).get('/v1/identity/wallets').set(auth);
      expect(listAfter.body.some((w: { address: string }) => w.address === address)).toBe(false);
    });

    it('rejects verification signed by the wrong account', async () => {
      const { token } = await issueSession();
      const account = privateKeyToAccount(generatePrivateKey());
      const otherAccount = privateKeyToAccount(generatePrivateKey());
      const auth = { Authorization: `Bearer ${token}` };

      const challenge = await request(app.getHttpServer()).post('/v1/identity/wallet/challenge').set(auth).send({ address: account.address });
      const wrongSignature = await otherAccount.signMessage({ message: challenge.body.message });

      const verify = await request(app.getHttpServer()).post('/v1/identity/wallet/verify').set(auth).send({ nonce: challenge.body.nonce, signature: wrongSignature });
      expect(verify.status).toBe(401);
    });

    it('rejects reusing an already-consumed nonce (replay protection)', async () => {
      const { token } = await issueSession();
      const account = privateKeyToAccount(generatePrivateKey());
      const auth = { Authorization: `Bearer ${token}` };

      const challenge = await request(app.getHttpServer()).post('/v1/identity/wallet/challenge').set(auth).send({ address: account.address });
      const signature = await account.signMessage({ message: challenge.body.message });

      await request(app.getHttpServer()).post('/v1/identity/wallet/verify').set(auth).send({ nonce: challenge.body.nonce, signature }).expect(200);
      const replay = await request(app.getHttpServer()).post('/v1/identity/wallet/verify').set(auth).send({ nonce: challenge.body.nonce, signature });
      expect(replay.status).toBe(400);
    });

    it('rejects verifying a challenge issued to a different session (no cross-user wallet linking)', async () => {
      const sessionA = await issueSession();
      const sessionB = await issueSession();
      const account = privateKeyToAccount(generatePrivateKey());

      const challenge = await request(app.getHttpServer())
        .post('/v1/identity/wallet/challenge')
        .set('Authorization', `Bearer ${sessionA.token}`)
        .send({ address: account.address });
      const signature = await account.signMessage({ message: challenge.body.message });

      const verify = await request(app.getHttpServer())
        .post('/v1/identity/wallet/verify')
        .set('Authorization', `Bearer ${sessionB.token}`)
        .send({ nonce: challenge.body.nonce, signature });
      expect(verify.status).toBe(400);
    });
  });

  describe('GET /v1/trade/quote', () => {
    it('requires authentication', async () => {
      const res = await request(app.getHttpServer()).get(
        `/v1/trade/quote?side=BUY&tokenAddress=${baseAddress}&walletAddress=0x1234567890123456789012345678901234567890&amount=1`,
      );
      expect(res.status).toBe(401);
    });

    it('rejects a wallet the caller has never verified — never trusts a client-asserted address', async () => {
      const { token } = await issueSession();
      const res = await request(app.getHttpServer())
        .get(`/v1/trade/quote?side=BUY&tokenAddress=${baseAddress}&walletAddress=0x1234567890123456789012345678901234567890&amount=1`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('rejects a malformed amount before it ever reaches the router', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const res = await request(app.getHttpServer())
        .get(`/v1/trade/quote?side=BUY&tokenAddress=${baseAddress}&walletAddress=${address}&amount=not-a-number`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('rejects a slippageBps outside the safe bounds', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const res = await request(app.getHttpServer())
        .get(`/v1/trade/quote?side=BUY&tokenAddress=${baseAddress}&walletAddress=${address}&amount=1&slippageBps=99999`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('404s a token address with no tracked market', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const res = await request(app.getHttpServer())
        .get(`/v1/trade/quote?side=BUY&tokenAddress=${untrackedTokenAddress}&walletAddress=${address}&amount=1`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns an honest 422 rather than a fabricated quote when the aggregator has no real key to answer with', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const res = await request(app.getHttpServer())
        .get(`/v1/trade/quote?side=BUY&tokenAddress=${baseAddress}&walletAddress=${address}&amount=1`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(422);
      expect(res.body.message).not.toMatch(/undefined|NaN/i);
    }, 20_000);
  });

  describe('POST /v1/trade/transactions', () => {
    it('requires authentication', async () => {
      const res = await request(app.getHttpServer()).post('/v1/trade/transactions').send({ quoteId: 'x', walletAddress: '0x1', txHash: '0x1' });
      expect(res.status).toBe(401);
    });

    it('rejects a malformed transaction hash', async () => {
      const { token } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const res = await request(app.getHttpServer())
        .post('/v1/trade/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({ quoteId: '00000000-0000-0000-0000-000000000000', walletAddress: address, txHash: 'not-a-hash' });
      expect(res.status).toBe(400);
    });

    it('rejects submitting a quote that belongs to another user', async () => {
      const owner = await issueSession();
      const { address: ownerWallet } = await linkVerifiedWallet(owner.token);
      const quote = await seedQuote(owner.userId, ownerWallet);

      const attacker = await issueSession();
      const res = await request(app.getHttpServer())
        .post('/v1/trade/transactions')
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ quoteId: quote.id, walletAddress: ownerWallet, txHash: `0x${'1'.repeat(64)}` });
      expect(res.status).toBe(403);
    });

    it('submits a valid, owned quote and is idempotent on a retried submission', async () => {
      const { token, userId } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const quote = await seedQuote(userId, address);
      const txHash = `0x${'2'.repeat(64)}`;
      const auth = { Authorization: `Bearer ${token}` };
      const body = { quoteId: quote.id, walletAddress: address, txHash };

      const first = await request(app.getHttpServer()).post('/v1/trade/transactions').set(auth).send(body);
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('PENDING');

      const retry = await request(app.getHttpServer()).post('/v1/trade/transactions').set(auth).send(body);
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id); // same row, not a duplicate
    });

    it('GET /v1/trade/transactions/:id enforces ownership (404 for another user) and leaves a real but unconfirmed hash PENDING', async () => {
      const { token, userId } = await issueSession();
      const { address } = await linkVerifiedWallet(token);
      const quote = await seedQuote(userId, address);
      const txHash = `0x${'3'.repeat(64)}`;
      const auth = { Authorization: `Bearer ${token}` };

      const submitted = await request(app.getHttpServer()).post('/v1/trade/transactions').set(auth).send({ quoteId: quote.id, walletAddress: address, txHash });
      expect(submitted.status).toBe(201);

      const other = await issueSession();
      const asOther = await request(app.getHttpServer())
        .get(`/v1/trade/transactions/${submitted.body.id}`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(asOther.status).toBe(404);

      // A real Base mainnet RPC read for a hash that was never actually broadcast — proves
      // status only ever moves on a real receipt, never a fabricated confirmation.
      const asOwner = await request(app.getHttpServer()).get(`/v1/trade/transactions/${submitted.body.id}`).set(auth);
      expect(asOwner.status).toBe(200);
      expect(asOwner.body.status).toBe('PENDING');
    }, 20_000);

    it('GET /v1/trade/history is scoped to the caller and ignores/rejects a client-supplied userId', async () => {
      const a = await issueSession();
      const { address: addressA } = await linkVerifiedWallet(a.token);
      const quoteA = await seedQuote(a.userId, addressA);
      await request(app.getHttpServer())
        .post('/v1/trade/transactions')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ quoteId: quoteA.id, walletAddress: addressA, txHash: `0x${'4'.repeat(64)}` })
        .expect(201);

      const b = await issueSession();
      const historyB = await request(app.getHttpServer()).get('/v1/trade/history').set('Authorization', `Bearer ${b.token}`);
      expect(historyB.status).toBe(200);
      expect(historyB.body.items).toEqual([]);

      const historyA = await request(app.getHttpServer()).get('/v1/trade/history').set('Authorization', `Bearer ${a.token}`);
      expect(historyA.status).toBe(200);
      expect(historyA.body.items.length).toBeGreaterThan(0);

      // The global ValidationPipe whitelists known query params — an unrecognized ?userId
      // is rejected outright rather than silently accepted or ignored.
      const spoofed = await request(app.getHttpServer())
        .get(`/v1/trade/history?userId=${a.userId}`)
        .set('Authorization', `Bearer ${b.token}`);
      expect(spoofed.status).toBe(400);
    });
  });
});
