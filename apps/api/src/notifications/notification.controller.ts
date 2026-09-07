import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Sse, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { NotificationPing } from '@fomo/domain';
import { filter, map, merge, interval, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationService } from './notification.service';

/**
 * Every mutation/list endpoint requires a session (`JwtAuthGuard`) and is scoped to that
 * session's own userId — never a client-supplied id, see docs/NOTIFICATIONS.md#security.
 * The one exception is `GET stream`, which authenticates via a short-lived single-use
 * ticket instead of the session guard, because the browser `EventSource` API cannot attach
 * an `Authorization` header (see NotificationService#issueStreamTicket).
 */
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  list(@Query() query: NotificationsQueryDto, @CurrentUser() user: SessionUser) {
    return this.notifications.list(user.id, query.cursor, query.limit);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: SessionUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('read-all')
  async markAllRead(@CurrentUser() user: SessionUser) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('preferences')
  getPreferences(@CurrentUser() user: SessionUser) {
    return this.notifications.getPreferences(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Patch('preferences')
  updatePreferences(@Body() body: UpdatePreferencesDto, @CurrentUser() user: SessionUser) {
    return this.notifications.updatePreferences(user.id, body);
  }

  // No @HttpCode override — a stream ticket is a newly created (single-use) resource, same
  // as a session or a wallet challenge, so this keeps Nest's default 201 for POST rather
  // than the 200 the toggle-style endpoints above use (follow/like, mark read).
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('stream-ticket')
  async issueStreamTicket(@CurrentUser() user: SessionUser) {
    const ticket = await this.notifications.issueStreamTicket(user.id);
    return { ticket };
  }

  /**
   * No `JwtAuthGuard` — see the class comment. Instead, the single-use ticket (issued only
   * to an authenticated caller via `stream-ticket` above) is resolved to a userId here, and
   * the stream is filtered server-side to that userId; a client can never subscribe to
   * anyone else's notifications by guessing or reusing a ticket (GETDEL makes it single-use).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Sse('stream')
  async stream(@Query('ticket') ticket: string | undefined): Promise<Observable<MessageEvent>> {
    const userId = ticket ? await this.notifications.consumeStreamTicket(ticket) : null;
    if (!userId) throw new UnauthorizedException('Missing or expired stream ticket');

    const notification$ = this.realtime.notificationEvents$.pipe(
      filter((ping: NotificationPing) => ping.userId === userId),
      map((ping: NotificationPing): MessageEvent => ({ type: 'notification', data: ping })),
    );
    // Same reasoning as the activity stream's heartbeat (see social.controller.ts): tells
    // "quietly live" apart from "actually disconnected" through idle-dropping proxies.
    const heartbeat$ = interval(20_000).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })),
    );
    return merge(notification$, heartbeat$);
  }
}
