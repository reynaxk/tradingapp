import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { DiscoveryService } from './discovery.service';
import { FeedQueryDto } from './dto/feed-query.dto';

function boundedLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

/**
 * Discovery rankings and personalization — see docs/TRADER_INTELLIGENCE.md. Ranking reads
 * are public (same authentication posture as /social/trending and /social/traders/top);
 * personalized reads require a session, and — like every personalized endpoint in this
 * codebase — always resolve identity from that session, never from a client-supplied id.
 */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('active-traders')
  activeTraders(@Query('limit') limit?: string) {
    return this.discovery.activeTraders(boundedLimit(limit, 10, 25));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('large-trades')
  largeTrades(@Query('limit') limit?: string) {
    return this.discovery.largeTrades(boundedLimit(limit, 20, 50));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('rising')
  async rising(@Query('limit') limit?: string) {
    const bounded = boundedLimit(limit, 10, 25);
    const [tokens, traders] = await Promise.all([this.discovery.risingTokens(bounded), this.discovery.risingTraders(bounded)]);
    return { tokens, traders };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('personalized')
  personalizedDiscovery(@CurrentUser() user: SessionUser, @Query('limit') limit?: string) {
    return this.discovery.personalizedDiscovery(user.id, boundedLimit(limit, 12, 30));
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('feed')
  personalizedFeed(@CurrentUser() user: SessionUser, @Query() query: FeedQueryDto) {
    return this.discovery.personalizedFeed(user.id, query.cursor, query.limit);
  }
}
