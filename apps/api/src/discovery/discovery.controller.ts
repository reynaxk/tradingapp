import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { DiscoveryService } from './discovery.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { ReturnLoopService } from './services/return-loop.service';
import { SavedSearchService } from './services/saved-search.service';

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
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly savedSearches: SavedSearchService,
    private readonly returnLoop: ReturnLoopService,
  ) {}

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
    const [tokens, traders] = await Promise.all([
      this.discovery.risingTokens(bounded),
      this.discovery.risingTraders(bounded),
    ]);
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

  // ---------------------------------------------------------------------------------------
  // Saved searches — see docs/PHASE6_RETENTION_SOCIAL.md#saved-searches. Every method scopes
  // to `user.id` from the session, never a client-supplied id — the IDOR defense.
  // ---------------------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Get('saved-searches')
  listSavedSearches(@CurrentUser() user: SessionUser) {
    return this.savedSearches.list(user.id);
  }

  // Deliberately higher than MAX_SAVED_SEARCHES_PER_USER (20): the throttle guards against
  // request abuse, the cap guards against unbounded state — keeping them numerically
  // distinct means hitting the cap is always observable as its own 400, never masked by a
  // 429 from the rate limiter along the way.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('saved-searches')
  createSavedSearch(@CurrentUser() user: SessionUser, @Body() body: CreateSavedSearchDto) {
    return this.savedSearches.create(user.id, body);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('saved-searches/:id')
  async deleteSavedSearch(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.savedSearches.delete(user.id, id);
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------------------
  // Return loop / streak — see docs/PHASE6_RETENTION_SOCIAL.md#return-loop.
  // ---------------------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Get('whats-missed')
  whatsMissed(@CurrentUser() user: SessionUser) {
    return this.returnLoop.whatsMissed(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('mark-seen')
  markSeen(@CurrentUser() user: SessionUser) {
    return this.returnLoop.markSeen(user.id);
  }
}
