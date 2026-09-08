import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { computeStreak, WHATS_MISSED_MAX_ITEMS, type WhatsMissed } from '@fomo/domain';
import { NOTIFICATION_INCLUDE, toNotificationDto } from '../../notifications/notification.mapper';

/**
 * The "what you missed" return loop and its streak signal — see
 * docs/PHASE6_RETENTION_SOCIAL.md#return-loop. Deliberately a thin read over the *existing*
 * `Notification` table (`createdAt > lastDiscoverySeenAt`, bounded `LIMIT`), never a new
 * parallel event-sourcing model — the spec's own explicit instruction. The streak itself is
 * the only "engagement" number this product tracks; see computeStreak in @fomo/domain for
 * why a plain read-then-overwrite is race-safe here without a transaction or CAS.
 */
@Injectable()
export class ReturnLoopService {
  /** Bounded preview of what happened since the viewer's last discover-page visit — never
   *  the full unread list (the notification center already serves that, paginated). A
   *  brand-new user (`lastDiscoverySeenAt: null`) sees their most recent notifications, same
   *  as "everything since the beginning." */
  async whatsMissed(userId: string): Promise<WhatsMissed> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastDiscoverySeenAt: true, currentStreakDays: true, longestStreakDays: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const since = user.lastDiscoverySeenAt ?? new Date(0);
    const [items, totalUnseen] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, createdAt: { gt: since } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: WHATS_MISSED_MAX_ITEMS,
        include: NOTIFICATION_INCLUDE,
      }),
      prisma.notification.count({ where: { userId, createdAt: { gt: since } } }),
    ]);

    return {
      items: items.map(toNotificationDto),
      totalUnseen,
      currentStreakDays: user.currentStreakDays,
      longestStreakDays: user.longestStreakDays,
    };
  }

  /**
   * Called once per discover-page visit. Advances the streak (see computeStreak) and stamps
   * `lastDiscoverySeenAt = now`, which is also what makes the *next* whatsMissed() call only
   * show genuinely new activity. A plain overwrite, never a compare-and-swap: every writer is
   * this same user, so two racing calls from separate tabs/sessions compute the identical
   * next state and simply agree — see the schema comment on User.lastDiscoverySeenAt.
   */
  async markSeen(userId: string): Promise<{ currentStreakDays: number; longestStreakDays: number }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastDiscoverySeenAt: true, currentStreakDays: true, longestStreakDays: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const next = computeStreak(user, now);

    await prisma.user.update({
      where: { id: userId },
      data: {
        lastDiscoverySeenAt: now,
        currentStreakDays: next.currentStreakDays,
        longestStreakDays: next.longestStreakDays,
      },
    });

    return next;
  }
}
