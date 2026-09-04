import { Module } from '@nestjs/common';

/**
 * Empty on purpose. Owns in-app/push/email notification delivery and user preferences
 * starting in Phase 5, consuming the same domain-event bus as every other module.
 */
@Module({})
export class NotificationsModule {}
