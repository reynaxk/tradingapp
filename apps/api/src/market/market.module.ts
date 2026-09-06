import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

/**
 * Read-only market data: chains, tokens, token_markets, and their derived
 * price/liquidity/volume/candle history. Owns nothing about discovery *ranking inputs* —
 * those are computed from data the ingestion worker (apps/workers) writes; this module
 * only ever reads. See docs/MARKET_DATA.md.
 */
@Module({
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
