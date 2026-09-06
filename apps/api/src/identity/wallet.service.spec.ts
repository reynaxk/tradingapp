import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { prisma } from '@fomo/db';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { WalletService } from './wallet.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    walletChallenge: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    wallet: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

// The well-known first Hardhat/Anvil test account — a real key with real signatures, but
// famous and funds-free, never used against anything but this local unit test.
const TEST_ACCOUNT = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = { CORS_ORIGIN: 'https://fomo.app,https://staging.fomo.app', CHAIN_ID: 8453 };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WalletService(fakeConfig(), fakeLogger());
  });

  describe('createChallenge', () => {
    it('rejects a malformed address before touching the database', async () => {
      await expect(service.createChallenge('user-1', 'not-an-address')).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.walletChallenge.create).not.toHaveBeenCalled();
    });

    it('issues a nonce, an expiring message naming the configured domain, and persists it tied to the caller', async () => {
      (mockedPrisma.walletChallenge.create as jest.Mock).mockResolvedValue({});

      const challenge = await service.createChallenge('user-1', TEST_ACCOUNT.address);

      expect(challenge.nonce).toHaveLength(32); // 16 bytes hex-encoded
      expect(challenge.message).toContain('fomo.app wants you to sign in');
      expect(challenge.message).toContain(TEST_ACCOUNT.address.toLowerCase());
      expect(new Date(challenge.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(mockedPrisma.walletChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', address: TEST_ACCOUNT.address.toLowerCase() }) }),
      );
    });
  });

  describe('verifyChallenge', () => {
    async function issuedChallenge(userId = 'user-1') {
      let stored: { id: string; address: string; nonce: string; message: string; userId: string; expiresAt: Date; usedAt: Date | null } | undefined;
      (mockedPrisma.walletChallenge.create as jest.Mock).mockImplementation(({ data }: { data: typeof stored }) => {
        stored = { id: 'challenge-1', usedAt: null, ...data } as typeof stored;
        return Promise.resolve(stored);
      });
      const challenge = await service.createChallenge(userId, TEST_ACCOUNT.address);
      (mockedPrisma.walletChallenge.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(stored));
      return { challenge, get stored() { return stored!; } };
    }

    it('links the wallet to the caller after a valid signature and consumes the nonce', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = await TEST_ACCOUNT.signMessage({ message: challenge.message });
      (mockedPrisma.walletChallenge.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockedPrisma.wallet.upsert as jest.Mock).mockResolvedValue({
        address: TEST_ACCOUNT.address.toLowerCase(),
        verifiedAt: new Date(),
        lastUsedAt: new Date(),
      });

      const linked = await service.verifyChallenge('user-1', challenge.nonce, signature);

      expect(linked.address).toBe(TEST_ACCOUNT.address.toLowerCase());
      expect(mockedPrisma.wallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ userId: 'user-1' }) }),
      );
    });

    it('rejects a signature from a different account than the one challenged', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const otherAccount = privateKeyToAccount(generatePrivateKey());
      const signature = await otherAccount.signMessage({ message: challenge.message });

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(UnauthorizedException);
      expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a syntactically valid but wrong signature (tampered/garbage bytes)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const validSig = await TEST_ACCOUNT.signMessage({ message: challenge.message });
      const tamperedSig = (`0x${'0'.repeat(129)}1c`) as `0x${string}`;
      expect(tamperedSig).not.toBe(validSig);

      await expect(service.verifyChallenge('user-1', challenge.nonce, tamperedSig)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown nonce', async () => {
      (mockedPrisma.walletChallenge.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyChallenge('user-1', 'never-issued', '0xdead')).rejects.toThrow(BadRequestException);
    });

    it('rejects a nonce issued to a different session (cross-user challenge use)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = await TEST_ACCOUNT.signMessage({ message: challenge.message });

      await expect(service.verifyChallenge('some-other-user', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge', async () => {
      let stored: Record<string, unknown> | undefined;
      (mockedPrisma.walletChallenge.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        stored = { id: 'challenge-1', usedAt: null, ...data };
        return Promise.resolve(stored);
      });
      const challenge = await service.createChallenge('user-1', TEST_ACCOUNT.address);
      stored!.expiresAt = new Date(Date.now() - 1000); // force expiry after issuance
      (mockedPrisma.walletChallenge.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(stored));
      const signature = await TEST_ACCOUNT.signMessage({ message: challenge.message });

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a nonce that has already been consumed (single-use / replay protection)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = await TEST_ACCOUNT.signMessage({ message: challenge.message });
      // updateMany reports 0 rows affected — someone else already flipped usedAt first.
      (mockedPrisma.walletChallenge.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.wallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listWallets / unlinkWallet', () => {
    it('lists only wallets linked to the caller', async () => {
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { address: TEST_ACCOUNT.address.toLowerCase(), verifiedAt: new Date(), lastUsedAt: new Date() },
      ]);

      const wallets = await service.listWallets('user-1');

      expect(mockedPrisma.wallet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
      expect(wallets).toHaveLength(1);
    });

    it('unlinks a wallet scoped to (address, caller) so it cannot detach someone else\'s link', async () => {
      (mockedPrisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unlinkWallet('user-1', TEST_ACCOUNT.address);

      expect(mockedPrisma.wallet.updateMany).toHaveBeenCalledWith({
        where: { address: TEST_ACCOUNT.address.toLowerCase(), userId: 'user-1' },
        data: { userId: null, verifiedAt: null },
      });
    });

    it('404s when the caller has no verified wallet at that address', async () => {
      (mockedPrisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.unlinkWallet('user-1', TEST_ACCOUNT.address)).rejects.toThrow('No verified wallet');
    });
  });
});
