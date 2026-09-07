import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import { PinoLogger } from 'nestjs-pino';
import { NotificationService } from '../../notifications/notification.service';

/**
 * Likes on an activity item — which *is* a Swap row (see the comment on Swap in
 * schema.prisma), so this never duplicates the underlying event, only adds engagement on
 * top of it. Uniqueness enforced at the database level, same idempotent-on-duplicate
 * pattern as FollowService. See docs/SOCIAL.md#social-signals.
 */
@Injectable()
export class LikeService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('LikeService');
  }

  async like(userId: string, swapId: string): Promise<void> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId }, select: { id: true, traderAddress: true } });
    if (!swap) throw new NotFoundException(`No activity item "${swapId}"`);

    try {
      await prisma.activityLike.create({ data: { userId, swapId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return; // already liked — idempotent success
      }
      throw error;
    }

    // Only on a genuine new like (not the P2002 branch above); see likeDedupeKey in
    // @fomo/domain for why re-liking after an unlike still wouldn't renotify if reached
    // again. A notification failure must never surface as a failed like.
    try {
      await this.notifications.notifyLike(userId, swap);
    } catch (error) {
      this.logger.error({ err: error, userId, swapId }, 'Failed to create LIKE notification');
    }
  }

  async unlike(userId: string, swapId: string): Promise<void> {
    await prisma.activityLike.deleteMany({ where: { userId, swapId } });
  }
}
