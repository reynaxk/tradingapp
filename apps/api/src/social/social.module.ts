import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ActivityService } from './services/activity.service';
import { FollowService } from './services/follow.service';
import { LikeService } from './services/like.service';
import { RealtimeService } from './services/realtime.service';
import { TraderService } from './services/trader.service';
import { TrendingService } from './services/trending.service';
import { SocialController } from './social.controller';

/**
 * Owns follows, activity feeds, likes, trending, and the realtime activity stream — see
 * docs/SOCIAL.md. Reads directly from `swaps`/`token_markets` (never a separate copy — see
 * the Swap model comment in schema.prisma). `IdentityModule` is imported for its guards
 * and `IdentityService`, which they depend on to resolve the calling session.
 */
@Module({
  imports: [IdentityModule],
  controllers: [SocialController],
  providers: [ActivityService, FollowService, LikeService, TraderService, TrendingService, RealtimeService],
})
export class SocialModule {}
