import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/**
 * Owns the notification domain — creation, read/unread state, preferences, and the private
 * per-user realtime stream. See docs/NOTIFICATIONS.md.
 *
 * FOLLOW/LIKE notifications are created by SocialModule's FollowService/LikeService calling
 * into `NotificationService` directly (this module is imported by SocialModule for that,
 * not the other way around — see the comment on SocialModule). FOLLOWED_TRADER_TRADE,
 * WHALE_TRADE, and TRENDING_TOKEN notifications are created independently by the ingestion
 * worker (apps/workers/src/notifications/notification-fanout.service.ts), which writes to
 * the same `notifications` table directly rather than calling into this API process — the
 * same "two orchestrators sharing pure domain logic" split Phase 3 established for trading.
 */
@Module({
  imports: [IdentityModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
