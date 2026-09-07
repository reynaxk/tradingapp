import type { SocialActivity } from '@fomo/domain';
import { Surface, cn } from '@fomo/ui';
import Link from 'next/link';
import { TradeButton } from '@/components/trading/TradeButton';
import { formatCompactUsd, formatPrice, formatRelativeTime, truncateAddress } from '@/lib/format';
import { LikeButton } from './LikeButton';
import { ShareButton } from './ShareButton';
import { TraderIdentity } from './TraderIdentity';

/**
 * The one reusable activity card — the feed, a trader's activity tab, and a token's
 * "who's trading this" section all render the same component. See
 * docs/SOCIAL.md#activity-model.
 */
export function ActivityCard({ activity }: { activity: SocialActivity }) {
  const isBuy = activity.action === 'BUY';
  const traderHref = activity.trader.address ? `/trader/${activity.trader.address}` : null;

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        {activity.trader.address ? (
          <Link href={traderHref!} className="min-w-0 hover:opacity-80">
            <TraderIdentity
              address={activity.trader.address}
              displayName={activity.trader.displayName}
              avatarUrl={activity.trader.avatarUrl}
              size="sm"
            />
          </Link>
        ) : (
          // A pre-Phase-2 swap indexed before trader capture existed — honest "unknown,"
          // never a fabricated address. See the traderAddress comment on Swap in schema.prisma.
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-[0.65rem] font-bold text-ink-400"
            >
              ?
            </div>
            <span className="font-body text-sm text-ink-400">Unknown trader</span>
          </div>
        )}
        <time
          dateTime={activity.timestamp}
          title={new Date(activity.timestamp).toLocaleString('en-US')}
          className="shrink-0 font-mono text-xs text-ink-400"
        >
          {formatRelativeTime(activity.timestamp)}
        </time>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'font-mono text-xs font-semibold uppercase tracking-wide',
            isBuy ? 'text-up' : 'text-down',
          )}
        >
          {isBuy ? 'Bought' : 'Sold'}
        </span>
        <span className="font-display text-lg font-bold tabular-nums text-ink-900">
          {formatCompactUsd(activity.amountUsd)}
        </span>
        <Link
          href={`/market/${activity.token.address}`}
          className="truncate font-display text-sm font-semibold text-ink-600 hover:text-accent"
        >
          {activity.token.symbol ?? truncateAddress(activity.token.address)}
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-3 font-mono text-xs text-ink-400">
          <span className="tabular-nums">{formatPrice(activity.priceUsd)}</span>
          <a
            href={`https://basescan.org/tx/${activity.txHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-accent"
            title={activity.txHash}
          >
            {truncateAddress(activity.txHash)}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {activity.token.decimals !== null && activity.token.quoteDecimals !== null && (
            <TradeButton
              label="Trade"
              variant="ghost"
              tokenAddress={activity.token.address}
              tokenSymbol={activity.token.symbol}
              tokenDecimals={activity.token.decimals}
              quoteTokenAddress={activity.token.quoteAddress}
              quoteTokenSymbol={activity.token.quoteSymbol}
              quoteTokenDecimals={activity.token.quoteDecimals}
            />
          )}
          <LikeButton
            activityId={activity.id}
            initialLikes={activity.social.likes}
            initialLikedByMe={activity.social.likedByMe}
          />
          <ShareButton
            compact
            title={`${isBuy ? 'Bought' : 'Sold'} ${formatCompactUsd(activity.amountUsd)} of ${activity.token.symbol ?? truncateAddress(activity.token.address)} on Fomo`}
            path={`/market/${activity.token.address}`}
          />
        </div>
      </div>
    </Surface>
  );
}
