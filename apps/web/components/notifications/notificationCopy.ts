import type { NotificationDto } from '@fomo/domain';
import { formatCompactUsd, truncateAddress } from '@/lib/format';

/**
 * Renders human copy from a notification's structured fields — never trusts a
 * server-composed sentence, since the API deliberately never sends one (see
 * docs/NOTIFICATIONS.md#data-model and NotificationDto in @fomo/domain). Pure and
 * unit-testable on its own, same reasoning as lib/format.ts.
 */
export function notificationCopy(n: NotificationDto): string {
  const actor = n.actor?.displayName ?? (n.actor?.address ? truncateAddress(n.actor.address) : 'Someone');
  const token = n.token?.symbol ?? (n.token?.address ? truncateAddress(n.token.address) : 'a token');
  const action = n.side === 'SELL' ? 'sold' : 'bought';

  switch (n.type) {
    case 'FOLLOW':
      return `${actor} started following you`;
    case 'LIKE':
      return `${actor} liked your trade`;
    case 'FOLLOWED_TRADER_TRADE':
      return `${actor} ${action} ${formatCompactUsd(n.amountUsd)} of ${token}`;
    case 'WHALE_TRADE':
      return `Whale trade — ${actor} ${action} ${formatCompactUsd(n.amountUsd)} of ${token}`;
    case 'TRENDING_TOKEN':
      return `${token} is trending`;
  }
}

/** A short, uppercase kind label — the same visual role as ActivityCard's "Bought"/"Sold"
 *  eyebrow, giving each notification type a quick-scan identity in a mixed-type list. */
export function notificationKindLabel(type: NotificationDto['type']): string {
  switch (type) {
    case 'FOLLOW':
      return 'Follow';
    case 'LIKE':
      return 'Like';
    case 'FOLLOWED_TRADER_TRADE':
      return 'Trade';
    case 'WHALE_TRADE':
      return 'Whale';
    case 'TRENDING_TOKEN':
      return 'Trending';
  }
}
