import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ACTIVITY_REALTIME_CHANNEL } from '@fomo/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { Subject } from 'rxjs';
import { REDIS_CLIENT } from '../../redis/redis.module';

export interface ActivityPing {
  tokenMarketId: string;
  count: number;
  atIso: string;
}

/**
 * Bridges the ingestion worker's Redis pub/sub ping to every connected SSE client — see
 * docs/SOCIAL.md#realtime. One dedicated subscriber connection for the whole process
 * (`redis.duplicate()`, since a subscribed ioredis connection can't run other commands),
 * fanned out to each request's stream via this RxJS Subject rather than one Redis
 * connection per connected browser.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly subject = new Subject<ActivityPing>();
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
    this.subscriber.on('message', (_channel, message) => {
      try {
        this.subject.next(JSON.parse(message) as ActivityPing);
      } catch (error) {
        this.logger.warn({ err: error }, 'Dropped a malformed realtime activity message');
      }
    });
    try {
      await this.subscriber.subscribe(ACTIVITY_REALTIME_CHANNEL);
    } catch (error) {
      // A down Redis at boot must not crash the API — the feed just falls back to a
      // "reconnecting" state client-side (see docs/SOCIAL.md#error-states) until it
      // reconnects on its own (ioredis retries by default).
      this.logger.error({ err: error }, 'Failed to subscribe to the realtime activity channel');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  get events$() {
    return this.subject.asObservable();
  }
}
