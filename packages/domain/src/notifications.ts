import { z } from 'zod';

/**
 * Phase 4 notification domain — see docs/NOTIFICATIONS.md. Pure types, configuration, and
 * deterministic logic only (no I/O, matching every other file in this package); the actual
 * database writes live in apps/api (follow/like) and apps/workers (indexed-activity-driven
 * types), sharing this module so both agree on dedupe keys, deep links, and thresholds.
 */

export const NotificationTypeSchema = z.enum(['FOLLOW', 'LIKE', 'FOLLOWED_TRADER_TRADE', 'WHALE_TRADE', 'TRENDING_TOKEN']);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Centralized, not scattered across controllers/workers — see docs/NOTIFICATIONS.md#whale-trades
 * and #trending-tokens. Every one of these can be overridden by env config; these are only
 * the shipped defaults.
 */
export const NOTIFICATION_DEFAULTS = {
  /** A single trade at/above this USD value is a "whale trade." */
  whaleTradeUsdThreshold: 25_000,
  /** Bounds notification explosions when one token receives many large trades in a burst —
   *  at most one WHALE_TRADE notification batch per token per this many minutes. See
   *  docs/NOTIFICATIONS.md#whale-trades. */
  whaleTradeCooldownMinutes: 15,
  /** Every preference defaults to enabled — see docs/NOTIFICATIONS.md#preferences for why
   *  an opt-out model fits a "make Fomo feel alive" product better than opt-in. */
  preferenceDefaults: {
    follows: true,
    likes: true,
    followedTraderTrades: true,
    whaleTrades: true,
    trendingTokens: true,
  },
} as const;

export const NotificationPreferencesSchema = z.object({
  follows: z.boolean(),
  likes: z.boolean(),
  followedTraderTrades: z.boolean(),
  whaleTrades: z.boolean(),
  trendingTokens: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/** Which preference gates a given notification type — the single place that mapping is
 *  defined, so a controller/worker never hardcodes "whaleTrades gates WHALE_TRADE" itself. */
export const NOTIFICATION_PREFERENCE_FIELD: Record<NotificationType, keyof NotificationPreferences> = {
  FOLLOW: 'follows',
  LIKE: 'likes',
  FOLLOWED_TRADER_TRADE: 'followedTraderTrades',
  WHALE_TRADE: 'whaleTrades',
  TRENDING_TOKEN: 'trendingTokens',
};

/**
 * The idempotency key within one (userId, type) pair — see docs/NOTIFICATIONS.md#idempotency.
 * Persisted as `Notification.dedupeKey`, enforced by `@@unique([userId, type, dedupeKey])`.
 * Never rely on in-memory dedup alone; these functions exist so every writer (API for
 * follow/like, worker for trade/whale/trending) builds the exact same key for the exact
 * same real-world event, regardless of how many times it's attempted.
 */
export function followDedupeKey(followerUserId: string): string {
  // Deliberately NOT per-follow-event: unfollowing and re-following the same trader must
  // never produce a second notification — see docs/NOTIFICATIONS.md#follow-notifications.
  return `follower:${followerUserId}`;
}
export function likeDedupeKey(likerUserId: string, swapId: string): string {
  return `liker:${likerUserId}:swap:${swapId}`;
}
export function followedTraderTradeDedupeKey(swapId: string): string {
  return `swap:${swapId}`;
}
export function whaleTradeDedupeKey(swapId: string): string {
  return `swap:${swapId}`;
}
/** `transitionAtIso` ties this key to one specific "entered trending" event — see
 *  docs/NOTIFICATIONS.md#trending-tokens. A later re-entry (a new transition) gets a new
 *  key and so can notify again; the same continuous trending streak never repeats. */
export function trendingTokenDedupeKey(tokenMarketId: string, transitionAtIso: string): string {
  return `token:${tokenMarketId}:since:${transitionAtIso}`;
}

/**
 * Deterministic destination for an actionable notification — see
 * docs/NOTIFICATIONS.md#deep-links. Uses this app's real routes (`/trader/[address]`,
 * `/market/[address]`), never an invented URL shape. `null` when the notification has
 * nothing to link to (e.g. an actor with no linked wallet) — never a fabricated link.
 */
export function notificationDeepLink(
  type: NotificationType,
  ctx: { actorWalletAddress: string | null; tokenAddress: string | null },
): string | null {
  switch (type) {
    case 'FOLLOW':
      return ctx.actorWalletAddress ? `/trader/${ctx.actorWalletAddress}` : null;
    case 'LIKE':
    case 'FOLLOWED_TRADER_TRADE':
    case 'WHALE_TRADE':
    case 'TRENDING_TOKEN':
      return ctx.tokenAddress ? `/market/${ctx.tokenAddress}` : null;
  }
}

/** One notification as the API serves it — structured fields only, never a pre-rendered
 *  sentence (see docs/NOTIFICATIONS.md#notification-center): the client renders copy per
 *  `type` from these fields, the same way `ActivityCard` already renders "Bought"/"Sold"
 *  from structured `SocialActivity` fields rather than a server-composed string. */
export const NotificationActorSchema = z.object({
  /** Nullable for the same reason `SocialActivity.trader.address` is (see social.ts): the
   *  acting user may have no verified wallet at all (following requires only an
   *  authenticated session, not a linked wallet). The UI falls back to generic copy and no
   *  deep link when this is null. */
  address: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type NotificationActor = z.infer<typeof NotificationActorSchema>;

export const NotificationTokenContextSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable(),
  logoUrl: z.string().nullable(),
});
export type NotificationTokenContext = z.infer<typeof NotificationTokenContextSchema>;

export const NotificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
  actor: NotificationActorSchema.nullable(),
  token: NotificationTokenContextSchema.nullable(),
  /** Trade value in USD — set for FOLLOWED_TRADER_TRADE/WHALE_TRADE, null otherwise. */
  amountUsd: z.number().nullable(),
  side: z.enum(['BUY', 'SELL']).nullable(),
  deepLink: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

/** Keyset cursor for the notification list — same reasoning as `ActivityCursor` in
 *  social.ts (a constantly-growing, per-user feed doesn't paginate safely by offset), kept
 *  as its own small type rather than generalized since it's keyed on `createdAt`, not
 *  `blockTimestamp`. */
export const NotificationCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
export type NotificationCursor = z.infer<typeof NotificationCursorSchema>;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Returns `null` for anything malformed — untrusted client input, same contract as
 *  `decodeActivityCursor`: garbage means "start from the beginning," never a 500. */
export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = NotificationCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const NotificationPageSchema = z.object({
  items: z.array(NotificationDtoSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/**
 * The bare realtime ping — see docs/NOTIFICATIONS.md#realtime-delivery. Deliberately small
 * (never the full notification payload) so SSE fan-out stays cheap regardless of how much
 * context a notification eventually carries; the client re-fetches the real thing over the
 * normal authenticated REST endpoint on receiving one, same "ping, then refetch" pattern
 * Phase 2's activity stream already established.
 */
export const NOTIFICATION_REALTIME_CHANNEL = 'fomo:notifications:new';
export interface NotificationPing {
  userId: string;
  notificationId: string;
  type: NotificationType;
  atIso: string;
}
