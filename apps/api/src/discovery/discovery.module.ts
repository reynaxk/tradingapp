import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MarketModule } from '../market/market.module';
import { SocialModule } from '../social/social.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { SavedSearchService } from './services/saved-search.service';
import { ReturnLoopService } from './services/return-loop.service';

/**
 * Phase 5 — trader intelligence, discovery rankings, and personalization. See
 * docs/TRADER_INTELLIGENCE.md. `IdentityModule` for JwtAuthGuard on the personalized
 * endpoints; `SocialModule` (which exports `ActivityService`) so the personalized feed
 * reuses the existing paginated activity-feed machinery rather than a second one.
 *
 * Phase 6 (see docs/PHASE6_RETENTION_SOCIAL.md) also owns saved searches
 * (`SavedSearchService`) and the return-loop/streak surface (`ReturnLoopService`) — both
 * personal-discovery state, the same home as personalizedDiscovery/personalizedFeed above.
 * `MarketModule` so DiscoveryService can read the viewer's watchlist for the personalization
 * signal via `WatchlistService`, without a second TokenWatch query implementation.
 */
@Module({
  imports: [IdentityModule, SocialModule, MarketModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, SavedSearchService, ReturnLoopService],
})
export class DiscoveryModule {}
