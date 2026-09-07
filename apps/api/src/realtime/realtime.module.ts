import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/**
 * Owns the single Redis pub/sub bridge shared by every SSE stream in the app (the public
 * activity feed and the private per-user notification stream) — see
 * docs/NOTIFICATIONS.md#realtime-delivery. Split out from SocialModule so it can be
 * imported by both SocialModule and NotificationsModule without those two depending on
 * each other: RealtimeService must exist as exactly one instance (it opens exactly one
 * Redis subscriber connection), so it lives in its own module rather than being provided by
 * either feature module.
 */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
