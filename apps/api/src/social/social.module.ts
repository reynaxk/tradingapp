import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MarketModule } from '../market/market.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityService } from './services/activity.service';
import { FollowService } from './services/follow.service';
import { LikeService } from './services/like.service';
import { TraderService } from './services/trader.service';
import { TrendingService } from './services/trending.service';
import { SocialController } from './social.controller';

/**
 * Owns follows, activity feeds, likes, and trending — see docs/SOCIAL.md. Reads directly
 * from `swaps`/`token_markets` (never a separate copy — see the Swap model comment in
 * schema.prisma). `IdentityModule` is imported for its guards and `IdentityService`, which
 * they depend on to resolve the calling session. `NotificationsModule` so
 * FollowService/LikeService can create FOLLOW/LIKE notifications on genuine creation (see
 * docs/NOTIFICATIONS.md) — a one-way dependency: NotificationsModule has no need to import
 * SocialModule back, so no circularity here (see RealtimeModule for the piece that would
 * have been circular). `RealtimeModule` backs this module's own SSE activity stream.
 *
 * `ActivityService` is exported so Phase 5's DiscoveryModule can reuse its paginated
 * swap-backed feed machinery for the personalized feed (see
 * ActivityService#getPersonalizedFeedCandidates) instead of a second implementation.
 *
 * `MarketModule` (Phase 6) so `GET /social/watchlist` can reuse `WatchlistService` rather
 * than a second TokenWatch query implementation — see docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 */
@Module({
  imports: [IdentityModule, RealtimeModule, NotificationsModule, MarketModule],
  controllers: [SocialController],
  providers: [ActivityService, FollowService, LikeService, TraderService, TrendingService],
  exports: [ActivityService],
})
export class SocialModule {}
