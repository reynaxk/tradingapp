import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DiscoverQueryDto } from './dto/discover-query.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { MarketService } from './market.service';

/**
 * Read-only. Every response is normalized DB state (see market.mapper.ts) — never a raw
 * Prisma row, so there's one place controlling exactly what the web app can see.
 */
@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get('discover')
  discover(@Query() query: DiscoverQueryDto) {
    return this.marketService.discover(query);
  }

  // Search is cheap enough per-call but easy to hammer from a debounced input; keep it
  // tighter than the global default rather than relying on that alone.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.marketService.search(query);
  }

  @Get('tokens/:address')
  getToken(@Param('address') address: string) {
    return this.marketService.getToken(address);
  }

  @Get('tokens/:address/history')
  getHistory(@Param('address') address: string, @Query() query: HistoryQueryDto) {
    return this.marketService.getHistory(address, query.timeframe);
  }
}
