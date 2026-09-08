import { NotFoundException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { ReturnLoopService } from './return-loop.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    notification: { findMany: jest.fn(), count: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';

describe('ReturnLoopService', () => {
  let service: ReturnLoopService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReturnLoopService();
  });

  describe('whatsMissed', () => {
    it('404s for a user that no longer exists', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.whatsMissed(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('treats a never-seen user as "everything since the beginning" rather than erroring', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: null,
        currentStreakDays: 0,
        longestStreakDays: 0,
      });
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await service.whatsMissed(USER_ID);

      const call = (mockedPrisma.notification.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.createdAt.gt.getTime()).toBe(0);
    });

    it('scopes the query to createdAt after the viewer\'s own last-seen timestamp', async () => {
      const lastSeen = new Date('2026-03-01T00:00:00.000Z');
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: lastSeen,
        currentStreakDays: 3,
        longestStreakDays: 5,
      });
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await service.whatsMissed(USER_ID);

      expect(mockedPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID, createdAt: { gt: lastSeen } } }),
      );
    });

    it('is bounded — passes a fixed take, never an unbounded query', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: null,
        currentStreakDays: 0,
        longestStreakDays: 0,
      });
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await service.whatsMissed(USER_ID);

      const call = (mockedPrisma.notification.findMany as jest.Mock).mock.calls[0][0];
      expect(typeof call.take).toBe('number');
      expect(call.take).toBeGreaterThan(0);
    });

    it('passes through the current and longest streak from the user row', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: null,
        currentStreakDays: 4,
        longestStreakDays: 9,
      });
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      const result = await service.whatsMissed(USER_ID);

      expect(result.currentStreakDays).toBe(4);
      expect(result.longestStreakDays).toBe(9);
    });
  });

  describe('markSeen', () => {
    it('404s for a user that no longer exists', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.markSeen(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('starts a fresh streak of 1 for a first-ever visit', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: null,
        currentStreakDays: 0,
        longestStreakDays: 0,
      });
      (mockedPrisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await service.markSeen(USER_ID);

      expect(result).toEqual({ currentStreakDays: 1, longestStreakDays: 1 });
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { lastDiscoverySeenAt: expect.any(Date), currentStreakDays: 1, longestStreakDays: 1 },
      });
    });

    it('does not double-count a second visit on the same UTC day', async () => {
      const now = new Date();
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: now,
        currentStreakDays: 3,
        longestStreakDays: 5,
      });
      (mockedPrisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await service.markSeen(USER_ID);

      expect(result).toEqual({ currentStreakDays: 3, longestStreakDays: 5 });
    });

    it('always writes its own userId, never a client-supplied one — the IDOR defense', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        lastDiscoverySeenAt: null,
        currentStreakDays: 0,
        longestStreakDays: 0,
      });
      (mockedPrisma.user.update as jest.Mock).mockResolvedValue({});

      await service.markSeen(USER_ID);

      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER_ID } }));
      expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER_ID } }));
    });
  });
});
