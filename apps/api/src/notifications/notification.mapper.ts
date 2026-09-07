import type { Prisma } from '@fomo/db';
import { notificationDeepLink, type NotificationDto } from '@fomo/domain';

/**
 * Every field this mapper needs, resolved in a single query via nested `include` (never a
 * per-row follow-up query — see docs/NOTIFICATIONS.md#performance). `actorUser.wallets` is
 * filtered/limited in the include itself (earliest-verified-first, take 1) so "which wallet
 * represents this acting user" is resolved server-side without a second round trip.
 */
export const NOTIFICATION_INCLUDE = {
  actorUser: {
    include: {
      wallets: { where: { verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' }, take: 1 },
    },
  },
  actorWallet: true,
  swap: { include: { tokenMarket: { include: { token: true } } } },
  tokenMarket: { include: { token: true } },
} satisfies Prisma.NotificationInclude;

export type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

/**
 * The one place a raw `notifications` row becomes the DTO the API serves — computed at read
 * time from the entities it references, never from a stored title/body (see the
 * Notification model comment in schema.prisma and docs/SOURCE_OF_TRUTH.md). Mirrors
 * `toSocialActivity` in social.mapper.ts: structured fields only, so the client renders
 * per-type copy itself.
 */
export function toNotificationDto(row: NotificationRow): NotificationDto {
  const actorWalletRow = row.actorWallet ?? row.actorUser?.wallets[0] ?? null;
  const hasActor = row.actorUserId !== null || row.actorWalletAddress !== null;
  const actor = hasActor
    ? {
        address: actorWalletRow?.address ?? null,
        displayName: actorWalletRow?.displayName ?? null,
        avatarUrl: actorWalletRow?.avatarUrl ?? null,
      }
    : null;

  // FOLLOWED_TRADER_TRADE/WHALE_TRADE carry their token via the referenced swap's own
  // market; TRENDING_TOKEN references the market directly with no swap at all.
  const tokenMarket = row.swap?.tokenMarket ?? row.tokenMarket ?? null;
  const token = tokenMarket
    ? { address: tokenMarket.token.contractAddress, symbol: tokenMarket.token.symbol, logoUrl: tokenMarket.token.logoUrl }
    : null;

  return {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    actor,
    token,
    amountUsd: row.swap ? Number(row.swap.volumeUsd) : null,
    side: row.swap ? (row.swap.side === 'buy' ? 'BUY' : 'SELL') : null,
    deepLink: notificationDeepLink(row.type, {
      actorWalletAddress: actor?.address ?? null,
      tokenAddress: token?.address ?? null,
    }),
  };
}
