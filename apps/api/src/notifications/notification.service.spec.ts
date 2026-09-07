import { Prisma, prisma } from '@fomo/db';
import { NOTIFICATION_REALTIME_CHANNEL } from '@fomo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { NotificationService } from './notification.service';

jest.mock('@fomo/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      wallet: { findUnique: jest.fn() },
      notification: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
      notificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const RECIPIENT_USER_ID = 'recipient-1';
const ACTOR_USER_ID = 'actor-1';
const WALLET = '0x1234567890123456789012345678901234567890';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;
}

function fakeRedis() {
  return { publish: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK'), getdel: jest.fn() };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
}

describe('NotificationService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    service = new NotificationService(redis as never, fakeLogger());
  });

  describe('notifyFollow', () => {
    it('creates a FOLLOW notification for the followed wallet\'s linked user', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: RECIPIENT_USER_ID });
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null); // defaults -> enabled
      (mockedPrisma.notification.create as jest.Mock).mockResolvedValue({
        id: 'notif-1',
        userId: RECIPIENT_USER_ID,
        type: 'FOLLOW',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).toHaveBeenCalledWith({
        data: { userId: RECIPIENT_USER_ID, type: 'FOLLOW', dedupeKey: `follower:${ACTOR_USER_ID}`, actorUserId: ACTOR_USER_ID },
      });
      expect(redis.publish).toHaveBeenCalledWith(
        NOTIFICATION_REALTIME_CHANNEL,
        JSON.stringify({ userId: RECIPIENT_USER_ID, notificationId: 'notif-1', type: 'FOLLOW', atIso: '2026-01-01T00:00:00.000Z' }),
      );
    });

    it('does nothing when the followed wallet has no linked account', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: null });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('never self-notifies when a user follows their own linked wallet', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: ACTOR_USER_ID });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('respects the recipient\'s disabled "follows" preference', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: RECIPIENT_USER_ID });
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
        follows: false,
        likes: true,
        followedTraderTrades: true,
        whaleTrades: true,
        trendingTokens: true,
      });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyLike', () => {
    it('does nothing for a swap with no attributable trader', async () => {
      await service.notifyLike(ACTOR_USER_ID, { id: 'swap-1', traderAddress: null });

      expect(mockedPrisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('never self-notifies a like on one\'s own trade', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: ACTOR_USER_ID });

      await service.notifyLike(ACTOR_USER_ID, { id: 'swap-1', traderAddress: WALLET });

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('create (idempotency)', () => {
    it('treats a unique-constraint violation as a silent no-op, not an error', async () => {
      (mockedPrisma.notification.create as jest.Mock).mockRejectedValue(uniqueConstraintError());

      await expect(
        service.create({ userId: RECIPIENT_USER_ID, type: 'LIKE', dedupeKey: 'k', actorUserId: ACTOR_USER_ID }),
      ).resolves.toBeUndefined();
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('still throws a genuine, unexpected database error', async () => {
      (mockedPrisma.notification.create as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(service.create({ userId: RECIPIENT_USER_ID, type: 'LIKE', dedupeKey: 'k' })).rejects.toThrow('connection lost');
    });
  });

  describe('markRead — IDOR safety', () => {
    it('scopes the update to both the notification id AND the caller\'s own userId', async () => {
      (mockedPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.markRead(RECIPIENT_USER_ID, 'notif-1');

      expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: RECIPIENT_USER_ID, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('preferences', () => {
    it('returns the shipped defaults when no preference row exists yet', async () => {
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null);

      const prefs = await service.getPreferences(RECIPIENT_USER_ID);

      expect(prefs).toEqual({ follows: true, likes: true, followedTraderTrades: true, whaleTrades: true, trendingTokens: true });
    });

    it('merges a partial update onto the current preferences rather than replacing them', async () => {
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null); // current = defaults
      (mockedPrisma.notificationPreference.upsert as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
        follows: true,
        likes: true,
        followedTraderTrades: true,
        whaleTrades: false,
        trendingTokens: true,
      });

      await service.updatePreferences(RECIPIENT_USER_ID, { whaleTrades: false });

      expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId: RECIPIENT_USER_ID },
        create: { userId: RECIPIENT_USER_ID, follows: true, likes: true, followedTraderTrades: true, whaleTrades: false, trendingTokens: true },
        update: { follows: true, likes: true, followedTraderTrades: true, whaleTrades: false, trendingTokens: true },
      });
    });
  });

  describe('SSE stream tickets', () => {
    it('issues a single-use ticket with a bounded TTL', async () => {
      const ticket = await service.issueStreamTicket(RECIPIENT_USER_ID);

      expect(typeof ticket).toBe('string');
      expect(ticket.length).toBeGreaterThan(16);
      expect(redis.set).toHaveBeenCalledWith(`notif:ticket:${ticket}`, RECIPIENT_USER_ID, 'EX', expect.any(Number));
    });

    it('consumes a ticket via an atomic get-and-delete', async () => {
      redis.getdel.mockResolvedValue(RECIPIENT_USER_ID);

      const userId = await service.consumeStreamTicket('some-ticket');

      expect(userId).toBe(RECIPIENT_USER_ID);
      expect(redis.getdel).toHaveBeenCalledWith('notif:ticket:some-ticket');
    });
  });
});
