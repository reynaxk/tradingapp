import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ACTIVITY_REALTIME_CHANNEL, NOTIFICATION_REALTIME_CHANNEL, type NotificationPing } from '@fomo/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { Subject } from 'rxjs';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface ActivityPing {
  tokenMarketId: string;
  count: number;
  atIso: string;
}

/**
 * Bridges Redis pub/sub pings to every connected SSE client — see docs/SOCIAL.md#realtime
 * and docs/NOTIFICATIONS.md#realtime-delivery. One dedicated subscriber connection for the
 * whole process (`redis.duplicate()`, since a subscribed ioredis connection can't run other
 * commands), subscribed to both the public activity channel (Phase 2) and the private
 * per-user notification channel (Phase 4), fanned out to each request's stream via one of
 * two RxJS Subjects rather than one Redis connection per connected browser.
 *
 * Publishing a notification ping is deliberately NOT done through this service — the
 * ingestion worker and NotificationService both publish directly on the shared REDIS_CLIENT
 * connection (an ordinary command, unlike subscribing), the same way `publishNewActivity`
 * in the worker already does for activity pings.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly activitySubject = new Subject<ActivityPing>();
  private readonly notificationSubject = new Subject<NotificationPing>();
  private subscriber: Redis | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('RealtimeService');
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', (err) => this.logger.error({ err }, 'Realtime Redis subscriber error'));
    this.subscriber.on('message', (channel, message) => {
      try {
        if (channel === ACTIVITY_REALTIME_CHANNEL) {
          this.activitySubject.next(JSON.parse(message) as ActivityPing);
        } else if (channel === NOTIFICATION_REALTIME_CHANNEL) {
          this.notificationSubject.next(JSON.parse(message) as NotificationPing);
        }
      } catch (error) {
        this.logger.warn({ err: error }, 'Dropped a malformed realtime message');
      }
    });
    try {
      await this.subscriber.subscribe(ACTIVITY_REALTIME_CHANNEL, NOTIFICATION_REALTIME_CHANNEL);
    } catch (error) {
      // A down Redis at boot must not crash the API — both feeds just fall back to their
      // "reconnecting"/persisted-fetch states client-side until it reconnects on its own
      // (ioredis retries by default). See docs/NOTIFICATIONS.md#failure-degradation.
      this.logger.error({ err: error }, 'Failed to subscribe to the realtime channels');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  get activityEvents$() {
    return this.activitySubject.asObservable();
  }

  get notificationEvents$() {
    return this.notificationSubject.asObservable();
  }
}
