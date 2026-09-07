import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import { normalizeEvmAddress } from '@fomo/domain';
import { PinoLogger } from 'nestjs-pino';
import { NotificationService } from '../../notifications/notification.service';

/**
 * Owns the follow relationship (User -> Wallet). Uniqueness is enforced at the database
 * level (`@@unique([userId, walletAddress])`) — this service treats a duplicate follow as
 * an idempotent success rather than an error, since "follow" is a toggle a double-click or
 * a retried request can legitimately fire twice. See docs/SOCIAL.md#follow-system.
 */
@Injectable()
export class FollowService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('FollowService');
  }

  async follow(userId: string, address: string): Promise<void> {
    const walletAddress = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet) {
      throw new NotFoundException(`No tracked trader for wallet "${address}" — it has never been observed trading`);
    }

    try {
      await prisma.follow.create({ data: { userId, walletAddress } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return; // already following — idempotent success, not an error
      }
      throw error;
    }

    // Only on a genuine new follow (not the P2002 idempotent-success branch above) — see
    // followDedupeKey in @fomo/domain for why a repeated unfollow/refollow still wouldn't
    // renotify even if this were reached again. A notification failure must never surface
    // as a failed follow — the follow itself already succeeded above.
    try {
      await this.notifications.notifyFollow(userId, walletAddress);
    } catch (error) {
      this.logger.error({ err: error, userId, walletAddress }, 'Failed to create FOLLOW notification');
    }
  }

  /** Idempotent by construction: deleting zero matching rows is not an error. */
  async unfollow(userId: string, address: string): Promise<void> {
    const walletAddress = normalizeEvmAddress(address);
    await prisma.follow.deleteMany({ where: { userId, walletAddress } });
  }

  /** `null` when there is no viewer to check against (unauthenticated) — never a fabricated
   *  `false`, see the isFollowedByMe comment on TraderProfileSchema. */
  async isFollowing(userId: string | null, address: string): Promise<boolean | null> {
    if (!userId) return null;
    const walletAddress = normalizeEvmAddress(address);
    const existing = await prisma.follow.findUnique({
      where: { userId_walletAddress: { userId, walletAddress } },
      select: { id: true },
    });
    return existing !== null;
  }
}
