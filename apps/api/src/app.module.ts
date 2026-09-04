import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { parseEnv } from '@fomo/domain';
import { LoggerModule, type Params } from 'nestjs-pino';
import { EnvSchema, type Env } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { SocialModule } from './social/social.module';
import { MarketModule } from './market/market.module';
import { TradingModule } from './trading/trading.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => parseEnv(EnvSchema, config),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Params => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Never let an auth header, cookie, or secret reach the logs, even by accident.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.secret',
              '*.token',
              '*.privateKey',
              '*.seedPhrase',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    RedisModule,
    HealthModule,
    IdentityModule,
    SocialModule,
    MarketModule,
    TradingModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
