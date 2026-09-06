'use client';

import type { SocialActivity } from '@fomo/domain';
import { cn } from '@fomo/ui';
import { useEffect, useState } from 'react';
import { fetchLatestFollowingActivity, hasStoredSession } from '@/lib/social-client';
import { ActivityFeed } from './ActivityFeed';
import { EmptyState } from '../market/EmptyState';
import { Skeleton } from '../market/Skeleton';

type FollowingState = 'idle' | 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * "For you" (global) vs "Following" (personalized) — see docs/SOCIAL.md#personalized-feed.
 * The global tab is server-rendered (fast first paint, matches every other page); the
 * following tab can't be — a Server Component has no way to see this browser's session
 * (see docs/SOCIAL.md#authentication) — so it fetches client-side on first switch, and
 * never creates a session just to check: a visitor with none yet sees an honest empty
 * state instead of silently getting signed up for one.
 */
export function ActivityFeedTabs({
  globalItems,
  globalCursor,
}: {
  globalItems: SocialActivity[];
  globalCursor: string | null;
}) {
  const [tab, setTab] = useState<'global' | 'following'>('global');
  const [followingState, setFollowingState] = useState<FollowingState>('idle');
  const [followingItems, setFollowingItems] = useState<SocialActivity[]>([]);
  const [followingCursor, setFollowingCursor] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'following' || followingState !== 'idle') return;
    if (!hasStoredSession()) {
      setFollowingState('no-session');
      return;
    }
    setFollowingState('loading');
    fetchLatestFollowingActivity({ limit: 20 })
      .then((page) => {
        setFollowingItems(page.items);
        setFollowingCursor(page.nextCursor);
        setFollowingState('loaded');
      })
      .catch(() => setFollowingState('error'));
  }, [tab, followingState]);

  return (
    <div>
      <div className="mb-4 flex gap-2" role="tablist">
        <TabButton active={tab === 'global'} onClick={() => setTab('global')}>
          For you
        </TabButton>
        <TabButton active={tab === 'following'} onClick={() => setTab('following')}>
          Following
        </TabButton>
      </div>

      {tab === 'global' && (
        <ActivityFeed
          initialItems={globalItems}
          initialCursor={globalCursor}
          scope={{ type: 'global' }}
          emptyTitle="No recent activity yet."
          emptyDetail="Once tracked markets see real swaps, they'll show up here."
        />
      )}

      {tab === 'following' && followingState === 'no-session' && (
        <EmptyState
          title="You're not following anyone yet."
          detail="Discover traders in Top Traders or the activity feed, and follow them to build your feed."
        />
      )}
      {tab === 'following' && (followingState === 'idle' || followingState === 'loading') && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}
      {tab === 'following' && followingState === 'error' && (
        <EmptyState title="Couldn't load your feed." detail="Try again in a moment." />
      )}
      {tab === 'following' && followingState === 'loaded' && (
        <ActivityFeed
          initialItems={followingItems}
          initialCursor={followingCursor}
          scope={{ type: 'following' }}
          emptyTitle="You're not following anyone yet."
          emptyDetail="Discover traders in Top Traders or the activity feed, and follow them to build your feed."
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide transition-colors',
        active ? 'bg-accent/10 text-accent' : 'text-ink-400 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  );
}
