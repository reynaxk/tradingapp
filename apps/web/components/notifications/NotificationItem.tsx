import type { NotificationDto } from '@fomo/domain';
import { cn } from '@fomo/ui';
import Link from 'next/link';
import { formatRelativeTime } from '@/lib/format';
import { notificationCopy, notificationKindLabel } from './notificationCopy';

const KIND_COLOR: Record<NotificationDto['type'], string> = {
  FOLLOW: 'text-accent',
  LIKE: 'text-accent',
  FOLLOWED_TRADER_TRADE: 'text-up',
  WHALE_TRADE: 'text-up',
  TRENDING_TOKEN: 'text-accent',
};

/**
 * One notification row — shared by the bell dropdown and the full /notifications page. An
 * unread notification gets a subtle accent-tinted background and a small dot, never a loud
 * badge or animation (see docs/NOTIFICATIONS.md's "premium, subtle" UI bar). Clicking marks
 * it read and follows its deep link, when it has one.
 */
export function NotificationItem({ notification, onOpen }: { notification: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  const isUnread = notification.readAt === null;
  const content = (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl px-3 py-3 transition-colors',
        isUnread ? 'bg-accent/[0.06] hover:bg-accent/10' : 'hover:bg-surface-raised',
      )}
    >
      <Avatar notification={notification} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('font-mono text-[0.65rem] font-semibold uppercase tracking-wide', KIND_COLOR[notification.type])}>
            {notificationKindLabel(notification.type)}
          </span>
          <time
            dateTime={notification.createdAt}
            title={new Date(notification.createdAt).toLocaleString('en-US')}
            className="font-mono text-[0.65rem] text-ink-400"
          >
            {formatRelativeTime(notification.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 truncate font-body text-sm text-ink-900">{notificationCopy(notification)}</p>
      </div>
      {isUnread && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
    </div>
  );

  if (!notification.deepLink) {
    return (
      <button type="button" onClick={() => onOpen(notification)} className="block w-full text-left">
        {content}
      </button>
    );
  }

  return (
    <Link href={notification.deepLink} onClick={() => onOpen(notification)} className="block">
      {content}
    </Link>
  );
}

function Avatar({ notification }: { notification: NotificationDto }) {
  if (notification.actor?.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={notification.actor.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  const initials = notification.actor?.displayName?.slice(0, 2)?.toUpperCase() ?? notification.actor?.address?.slice(2, 4)?.toUpperCase();
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-xs font-bold text-accent"
    >
      {initials ?? notificationKindLabel(notification.type).slice(0, 1)}
    </div>
  );
}
