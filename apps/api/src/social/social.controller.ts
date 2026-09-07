import { Controller, Delete, Get, HttpCode, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { map, merge, interval, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { AddressParamDto } from './dto/address-param.dto';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { CursorQueryDto } from './dto/cursor-query.dto';
import { TraderSearchQueryDto } from './dto/trader-search-query.dto';
import { ActivityService } from './services/activity.service';
import { FollowService } from './services/follow.service';
import { LikeService } from './services/like.service';
import { RealtimeService, type ActivityPing } from '../realtime/realtime.service';
import { TraderService } from './services/trader.service';
import { TrendingService } from './services/trending.service';

/**
 * Every response is a normalized domain object (see social.mapper.ts) — never a raw Prisma
 * row. Reads are public (`OptionalAuthGuard` at most, for light personalization); mutations
 * require a session (`JwtAuthGuard`) — see docs/SOCIAL.md#authentication.
 */
@Controller('social')
export class SocialController {
  constructor(
    private readonly activity: ActivityService,
    private readonly follows: FollowService,
    private readonly likes: LikeService,
    private readonly traders: TraderService,
    private readonly trending: TrendingService,
    private readonly realtime: RealtimeService,
  ) {}

  @UseGuards(OptionalAuthGuard)
  @Get('activity')
  getActivity(@Query() query: ActivityQueryDto, @CurrentUser() user: SessionUser | null) {
    return this.activity.getGlobalFeed({
      cursor: query.cursor,
      limit: query.limit,
      tokenAddress: query.tokenAddress,
      viewerUserId: user?.id ?? null,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('activity/following')
  getFollowingActivity(@Query() query: CursorQueryDto, @CurrentUser() user: SessionUser) {
    return this.activity.getFollowingFeed({ userId: user.id, cursor: query.cursor, limit: query.limit });
  }

  /** Public — this is a "something changed" ping, never user-specific data, so it never
   *  needs the auth EventSource can't attach anyway. See docs/SOCIAL.md#realtime. */
  @Sse('activity/stream')
  streamActivity(): Observable<MessageEvent> {
    const activity$ = this.realtime.activityEvents$.pipe(
      map((ping: ActivityPing): MessageEvent => ({ type: 'activity', data: ping })),
    );
    // Idle SSE connections get silently dropped by some proxies/load balancers; a periodic
    // heartbeat lets the client tell "quietly live" apart from "actually disconnected"
    // instead of pretending the feed is live when it isn't (docs/SOCIAL.md#error-states).
    const heartbeat$ = interval(20_000).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })),
    );
    return merge(activity$, heartbeat$);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('activity/:id/like')
  like(@Param('id') swapId: string, @CurrentUser() user: SessionUser) {
    return this.likes.like(user.id, swapId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('activity/:id/like')
  unlike(@Param('id') swapId: string, @CurrentUser() user: SessionUser) {
    return this.likes.unlike(user.id, swapId);
  }

  // Registered before `traders/:address` so a literal "search" segment doesn't get
  // swallowed by the address param route below.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('traders/search')
  searchTraders(@Query() query: TraderSearchQueryDto) {
    return this.traders.search(query.q, query.limit);
  }

  @Get('trending')
  getTrending(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 20;
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
    return this.trending.getTrending(bounded);
  }

  // Also registered before `traders/:address`, same reasoning as `traders/search` above.
  @Get('traders/top')
  getTopTraders(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 10;
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 25) : 10;
    return this.traders.getTopTraders(bounded);
  }

  @UseGuards(OptionalAuthGuard)
  @Get('traders/:address')
  getTraderProfile(@Param() params: AddressParamDto, @CurrentUser() user: SessionUser | null) {
    return this.traders.getProfile(params.address, user?.id ?? null);
  }

  @UseGuards(OptionalAuthGuard)
  @Get('traders/:address/activity')
  getTraderActivity(
    @Param() params: AddressParamDto,
    @Query() query: CursorQueryDto,
    @CurrentUser() user: SessionUser | null,
  ) {
    return this.activity.getTraderActivity({
      address: params.address,
      cursor: query.cursor,
      limit: query.limit,
      viewerUserId: user?.id ?? null,
    });
  }

  @Get('traders/:address/followers')
  getTraderFollowers(@Param() params: AddressParamDto, @Query() query: CursorQueryDto) {
    return this.traders.getFollowers(params.address, query.cursor, query.limit);
  }

  @Get('traders/:address/following')
  getTraderFollowing(@Param() params: AddressParamDto, @Query() query: CursorQueryDto) {
    return this.traders.getFollowing(params.address, query.cursor, query.limit);
  }

  /** Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-to-token. A bounded ranking (this
   *  trader's own most-significant tokens), not an infinite feed — no cursor, same
   *  convention as getTopTraders/getTrending. */
  @Get('traders/:address/tokens')
  getTraderTokens(@Param() params: AddressParamDto, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 20;
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
    return this.traders.getTraderTokens(params.address, bounded);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('traders/:address/follow')
  async follow(@Param() params: AddressParamDto, @CurrentUser() user: SessionUser) {
    await this.follows.follow(user.id, params.address);
    return { following: true };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('traders/:address/follow')
  async unfollow(@Param() params: AddressParamDto, @CurrentUser() user: SessionUser) {
    await this.follows.unfollow(user.id, params.address);
    return { following: false };
  }
}
