import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import { normalizeEvmAddress } from '@fomo/domain';

/**
 * Owns the follow relationship (User -> Wallet). Uniqueness is enforced at the database
 * level (`@@unique([userId, walletAddress])`) — this service treats a duplicate follow as
 * an idempotent success rather than an error, since "follow" is a toggle a double-click or
 * a retried request can legitimately fire twice. See docs/SOCIAL.md#follow-system.
 */
@Injectable()
export class FollowService {
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
