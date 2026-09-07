import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  followDedupeKey,
  likeDedupeKey,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_REALTIME_CHANNEL,
  type NotificationPage,
  type NotificationPing,
  type NotificationPreferences,
  type NotificationType,
} from '@fomo/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { NOTIFICATION_INCLUDE, toNotificationDto } from './notification.mapper';

/** Single-use SSE stream ticket TTL — long enough to cover the round trip from issuing it
 *  to the browser opening the EventSource connection, short enough to bound the exposure of
 *  a credential that (unlike the session JWT) necessarily travels in a URL query string,
 *  since EventSource cannot attach an Authorization header. See docs/NOTIFICATIONS.md#realtime-delivery. */
const STREAM_TICKET_TTL_SECONDS = 30;
const STREAM_TICKET_PREFIX = 'notif:ticket:';

/**
 * Owns notification creation, reads, and preferences — see docs/NOTIFICATIONS.md. Every
 * read/write here is scoped to a `userId` the caller resolved from an authenticated session
 * (see notification.controller.ts); this service never accepts a client-supplied recipient
 * id, which is the whole IDOR/spoofing defense (docs/NOTIFICATIONS.md#security).
 *
 * Creation is idempotent by construction: every `create()` call goes through the same
 * `dedupeKey` + `@@unique([userId, type, dedupeKey])` path FollowService/LikeService already
 * use for follows/likes themselves, so a retried request, a duplicate event, or a worker
 * re-run can never produce two notifications for the same real-world event.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('NotificationService');
  }

  // ---------------------------------------------------------------------------------------
  // Creation — follow/like are triggered directly from the authenticated action itself
  // (FollowService/LikeService), which is what makes them trustworthy: neither takes a
  // recipient id from the caller, only a userId already resolved from that caller's own
  // session, plus a wallet address looked up server-side.
  // ---------------------------------------------------------------------------------------

  /** Called from FollowService.follow() on genuine (non-duplicate) follow creation. */
  async notifyFollow(followerUserId: string, followedWalletAddress: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { address: followedWalletAddress }, select: { userId: true } });
    if (!wallet?.userId) return; // followed wallet has no linked account — no one to notify
    if (wallet.userId === followerUserId) return; // never self-notify

    const enabled = await this.isEnabled(wallet.userId, 'FOLLOW');
    if (!enabled) return;

    await this.create({
      userId: wallet.userId,
      type: 'FOLLOW',
      dedupeKey: followDedupeKey(followerUserId),
      actorUserId: followerUserId,
    });
  }

  /** Called from LikeService.like() on genuine (non-duplicate) like creation. */
  async notifyLike(likerUserId: string, swap: { id: string; traderAddress: string | null }): Promise<void> {
    if (!swap.traderAddress) return; // pre-Phase-2 swap with no captured trader — no one to notify
    const wallet = await prisma.wallet.findUnique({ where: { address: swap.traderAddress }, select: { userId: true } });
    if (!wallet?.userId) return;
    if (wallet.userId === likerUserId) return; // never self-notify

    const enabled = await this.isEnabled(wallet.userId, 'LIKE');
    if (!enabled) return;

    await this.create({
      userId: wallet.userId,
      type: 'LIKE',
      dedupeKey: likeDedupeKey(likerUserId, swap.id),
      actorUserId: likerUserId,
      swapId: swap.id,
    });
  }

  /**
   * The shared creation path every notification type (API and worker) ultimately goes
   * through — see FOLLOWED_TRADER_TRADE/WHALE_TRADE/TRENDING_TOKEN creation in
   * apps/workers/src/notifications/notification-fanout.service.ts, which duplicates this
   * same create-then-publish shape independently rather than calling into the API process
   * (see the TransactionService/TradeSweepService precedent this mirrors).
   */
  async create(input: {
    userId: string;
    type: NotificationType;
    dedupeKey: string;
    actorUserId?: string;
    actorWalletAddress?: string;
    swapId?: string;
    tokenMarketId?: string;
  }): Promise<void> {
    let created;
    try {
      created = await prisma.notification.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.debug({ userId: input.userId, type: input.type }, 'Duplicate notification suppressed by idempotency key');
        return;
      }
      throw error;
    }
    this.logger.info({ notificationId: created.id, userId: created.userId, type: created.type }, 'Notification created');
    await this.publish({
      userId: created.userId,
      notificationId: created.id,
      type: created.type,
      atIso: created.createdAt.toISOString(),
    });
  }

  private async publish(ping: NotificationPing): Promise<void> {
    try {
      await this.redis.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(ping));
    } catch (error) {
      // Persistence already happened above — a publish failure only delays the recipient
      // seeing it live; they'll see it on their next fetch/reconnect regardless. See
      // docs/NOTIFICATIONS.md#failure-degradation.
      this.logger.warn({ err: error }, 'Failed to publish realtime notification ping');
    }
  }

  // ---------------------------------------------------------------------------------------
  // Reads — every method takes userId as an explicit argument resolved by the controller
  // from the authenticated session; none of them accept it from request input.
  // ---------------------------------------------------------------------------------------

  async list(userId: string, rawCursor: string | undefined, limit: number): Promise<NotificationPage> {
    const cursor = rawCursor ? decodeNotificationCursor(rawCursor) : null;
    const cursorWhere: Prisma.NotificationWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }
      : {};

    const rows = await prisma.notification.findMany({
      where: { AND: [{ userId }, cursorWhere] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: NOTIFICATION_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeNotificationCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map(toNotificationDto), nextCursor };
  }

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Scoped to `userId` in the WHERE clause, not just the id — someone else's notification
   *  id simply matches zero rows rather than ever being reachable. This is the IDOR defense
   *  for this endpoint (docs/NOTIFICATIONS.md#security), not a separate ownership check. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  // ---------------------------------------------------------------------------------------
  // Preferences — no row means every default applies (see NOTIFICATION_DEFAULTS in
  // @fomo/domain); a row is created lazily on first write only.
  // ---------------------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await prisma.notificationPreference.findUnique({ where: { userId } });
    return row
      ? {
          follows: row.follows,
          likes: row.likes,
          followedTraderTrades: row.followedTraderTrades,
          whaleTrades: row.whaleTrades,
          trendingTokens: row.trendingTokens,
        }
      : NOTIFICATION_DEFAULTS.preferenceDefaults;
  }

  async updatePreferences(userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const current = await this.getPreferences(userId);
    const next = { ...current, ...patch };
    const row = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...next },
      update: { ...next },
    });
    return {
      follows: row.follows,
      likes: row.likes,
      followedTraderTrades: row.followedTraderTrades,
      whaleTrades: row.whaleTrades,
      trendingTokens: row.trendingTokens,
    };
  }

  /** Whether `type` should currently notify `userId` — every creation path checks this
   *  before writing a row, per docs/NOTIFICATIONS.md#preferences ("server-authoritative,
   *  never trust client-provided preference state"): the check itself always reads the
   *  database fresh, never a client-asserted value. */
  private async isEnabled(userId: string, type: NotificationType): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    switch (type) {
      case 'FOLLOW':
        return prefs.follows;
      case 'LIKE':
        return prefs.likes;
      case 'FOLLOWED_TRADER_TRADE':
        return prefs.followedTraderTrades;
      case 'WHALE_TRADE':
        return prefs.whaleTrades;
      case 'TRENDING_TOKEN':
        return prefs.trendingTokens;
      default: {
        const exhaustive: never = type;
        throw new Error(`Unhandled notification type: ${String(exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // SSE stream tickets — see the STREAM_TICKET_TTL_SECONDS comment above for why this
  // exists at all (EventSource can't send an Authorization header).
  // ---------------------------------------------------------------------------------------

  async issueStreamTicket(userId: string): Promise<string> {
    const ticket = randomBytes(32).toString('hex');
    await this.redis.set(`${STREAM_TICKET_PREFIX}${ticket}`, userId, 'EX', STREAM_TICKET_TTL_SECONDS);
    return ticket;
  }

  /** Atomically reads and deletes the ticket (Redis GETDEL) so it can only ever be
   *  consumed once, however many times a client (accidentally or via retry logic) presents
   *  it. Returns `null` for a missing, expired, or already-consumed ticket. */
  async consumeStreamTicket(ticket: string): Promise<string | null> {
    return this.redis.getdel(`${STREAM_TICKET_PREFIX}${ticket}`);
  }
}
