import { Module } from '@nestjs/common';

/**
 * Empty on purpose. Owns chains, tokens, token_markets, trending, and token-detail reads
 * starting in Phase 1. The Phase 0 migration already creates its tables; this module is
 * where the read API around them lands.
 */
@Module({})
export class MarketModule {}
