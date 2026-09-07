import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { WatchlistService } from './watchlist.service';

/**
 * Read-only market data: chains, tokens, token_markets, and their derived
 * price/liquidity/volume/candle history. Owns nothing about discovery *ranking inputs* —
 * those are computed from data the ingestion worker (apps/workers) writes; this module
 * only ever reads. See docs/MARKET_DATA.md.
 *
 * Phase 6 — also owns `TokenWatch` (WatchlistService), since watch/unwatch/check are
 * exposed as `/market/tokens/:address/watch`, mirroring the existing
 * `/market/tokens/:address/traders` precedent. `IdentityModule` for JwtAuthGuard on the
 * mutating routes. Exported so SocialModule (watchlist listing) and DiscoveryModule
 * (the personalization watchlist signal) can reuse it rather than a second implementation
 * — see docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 */
@Module({
  imports: [IdentityModule],
  controllers: [MarketController],
  providers: [MarketService, WatchlistService],
  exports: [WatchlistService],
})
export class MarketModule {}
