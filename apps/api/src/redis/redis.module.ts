import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * One shared ioredis connection for the whole process — the health check today, and the
 * future home of cache-aside reads, pub/sub fanout, and queue backing storage. Global so
 * every module can inject REDIS_CLIENT without importing RedisModule directly.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (config: ConfigService<Env, true>, logger: PinoLogger) => {
        logger.setContext('RedisClient');
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
        });
        // ioredis logs unhandled reconnect errors straight to stderr if nothing is
        // listening for 'error' — routing them through pino keeps every log line
        // structured (and subject to the same secret redaction) instead of a second,
        // uncontrolled output path. The health check still reports connectivity
        // correctly regardless; this only governs where the noise goes.
        client.on('error', (err) => logger.error({ err }, 'Redis client error'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
