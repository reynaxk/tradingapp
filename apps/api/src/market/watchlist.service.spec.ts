import { NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import { WatchlistService } from './watchlist.service';

jest.mock('@fomo/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      tokenMarket: { findFirst: jest.fn() },
      tokenWatch: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const TOKEN_ADDRESS = '0x1234567890123456789012345678901234567890';
const MARKET_ID = 'market-1';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('WatchlistService', () => {
  let service: WatchlistService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WatchlistService();
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue({ id: MARKET_ID });
  });

  describe('watch', () => {
    it('rejects a malformed address before ever touching the database', async () => {
      await expect(service.watch(USER_ID, 'not-an-address')).rejects.toThrow();
      expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
    });

    it('404s when the address has no tracked market', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.watch(USER_ID, TOKEN_ADDRESS)).rejects.toThrow(NotFoundException);
    });

    it('creates a TokenWatch row scoped to the resolved market and the given user', async () => {
      (mockedPrisma.tokenWatch.create as jest.Mock).mockResolvedValue({});
      await service.watch(USER_ID, TOKEN_ADDRESS);
      expect(mockedPrisma.tokenWatch.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, tokenMarketId: MARKET_ID },
      });
    });

    it('treats a duplicate watch (P2002) as an idempotent success, not an error', async () => {
      (mockedPrisma.tokenWatch.create as jest.Mock).mockRejectedValue(uniqueConstraintError());
      await expect(service.watch(USER_ID, TOKEN_ADDRESS)).resolves.toBeUndefined();
    });

    it('propagates a genuinely unexpected database error rather than swallowing it', async () => {
      (mockedPrisma.tokenWatch.create as jest.Mock).mockRejectedValue(new Error('connection lost'));
      await expect(service.watch(USER_ID, TOKEN_ADDRESS)).rejects.toThrow('connection lost');
    });
  });

  describe('unwatch', () => {
    it('is idempotent — deleting zero matching rows is a success, not an error', async () => {
      (mockedPrisma.tokenWatch.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(service.unwatch(USER_ID, TOKEN_ADDRESS)).resolves.toBeUndefined();
    });

    it("scopes the delete to both the caller's own userId and the resolved market — never another user's row", async () => {
      (mockedPrisma.tokenWatch.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
      await service.unwatch(USER_ID, TOKEN_ADDRESS);
      expect(mockedPrisma.tokenWatch.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, tokenMarketId: MARKET_ID },
      });
    });
  });

  describe('isWatching', () => {
    it('returns null (not false) for an unauthenticated caller — never a fabricated answer', async () => {
      expect(await service.isWatching(null, TOKEN_ADDRESS)).toBeNull();
      expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
    });

    it('returns true when a watch row exists for this user and market', async () => {
      (mockedPrisma.tokenWatch.findUnique as jest.Mock).mockResolvedValue({ id: 'watch-1' });
      expect(await service.isWatching(USER_ID, TOKEN_ADDRESS)).toBe(true);
    });

    it('returns false when no watch row exists', async () => {
      (mockedPrisma.tokenWatch.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.isWatching(USER_ID, TOKEN_ADDRESS)).toBe(false);
    });
  });

  describe('listForUser', () => {
    it('is scoped to the given userId only — cross-user isolation', async () => {
      (mockedPrisma.tokenWatch.findMany as jest.Mock).mockResolvedValue([]);
      await service.listForUser(USER_ID, undefined, 20);
      const call = (mockedPrisma.tokenWatch.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.AND).toContainEqual({ userId: USER_ID });
    });

    it("never returns another user's watches even if their id were somehow passed in", async () => {
      (mockedPrisma.tokenWatch.findMany as jest.Mock).mockResolvedValue([]);
      await service.listForUser(OTHER_USER_ID, undefined, 20);
      const call = (mockedPrisma.tokenWatch.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.AND).toContainEqual({ userId: OTHER_USER_ID });
      expect(call.where.AND).not.toContainEqual({ userId: USER_ID });
    });

    it('requests one more row than the limit to detect a next page, and trims it off the returned items', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `watch-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
        tokenMarket: {
          token: {
            contractAddress: '0xabc',
            symbol: 'T',
            name: 'Tok',
            decimals: 18,
            logoUrl: null,
          },
          quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
          chain: { identifier: 'ethereum' },
          dex: null,
          feeTier: null,
          priceUsd: null,
          liquidityUsd: null,
          volume24hUsd: null,
          priceChange24hPct: null,
          marketCapUsd: null,
          lastPriceUpdateAt: null,
        },
      }));
      (mockedPrisma.tokenWatch.findMany as jest.Mock).mockResolvedValue(rows);

      const page = await service.listForUser(USER_ID, undefined, 2);

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
    });

    it('reports no next page when fewer rows than the limit come back', async () => {
      (mockedPrisma.tokenWatch.findMany as jest.Mock).mockResolvedValue([]);
      const page = await service.listForUser(USER_ID, undefined, 20);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('getWatcherCount', () => {
    it('is a single bounded COUNT scoped to the given market', async () => {
      (mockedPrisma.tokenWatch.count as jest.Mock).mockResolvedValue(7);
      expect(await service.getWatcherCount(MARKET_ID)).toBe(7);
      expect(mockedPrisma.tokenWatch.count).toHaveBeenCalledWith({
        where: { tokenMarketId: MARKET_ID },
      });
    });
  });

  describe('getWatchedSet', () => {
    it('returns an empty set without querying when there are no candidates', async () => {
      const result = await service.getWatchedSet(USER_ID, []);
      expect(result.size).toBe(0);
      expect(mockedPrisma.tokenWatch.findMany).not.toHaveBeenCalled();
    });

    it('issues one bounded IN query regardless of candidate count', async () => {
      (mockedPrisma.tokenWatch.findMany as jest.Mock).mockResolvedValue([{ tokenMarketId: 'a' }]);
      const result = await service.getWatchedSet(USER_ID, ['a', 'b', 'c']);
      expect(result.has('a')).toBe(true);
      expect(result.has('b')).toBe(false);
      expect(mockedPrisma.tokenWatch.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
