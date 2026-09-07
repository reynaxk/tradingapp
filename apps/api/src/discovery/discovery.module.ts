import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SocialModule } from '../social/social.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

/**
 * Phase 5 — trader intelligence, discovery rankings, and personalization. See
 * docs/TRADER_INTELLIGENCE.md. `IdentityModule` for JwtAuthGuard on the personalized
 * endpoints; `SocialModule` (which exports `ActivityService`) so the personalized feed
 * reuses the existing paginated activity-feed machinery rather than a second one.
 */
@Module({
  imports: [IdentityModule, SocialModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
