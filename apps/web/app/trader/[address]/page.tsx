import { Surface } from '@fomo/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityFeed } from '@/components/social/ActivityFeed';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { FollowButton } from '@/components/social/FollowButton';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { MarketHeader } from '@/components/market/MarketHeader';
import { formatCompactUsd, formatDateTime, truncateAddress } from '@/lib/format';
import { fetchTraderActivity, fetchTraderProfile } from '@/lib/social-api';

export const revalidate = 15;

export default async function TraderProfilePage({ params }: { params: { address: string } }) {
  const profile = await fetchTraderProfile(params.address);
  if (!profile) notFound();

  const activity = await fetchTraderActivity(params.address, { limit: 20 });

  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to Discover
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TraderIdentity address={profile.address} displayName={profile.displayName} avatarUrl={profile.avatarUrl} size="lg" />
            <CopyAddressButton address={profile.address} />
          </div>
          <FollowButton address={profile.address} initialFollowing={profile.isFollowedByMe} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total trades" value={profile.stats.totalSwaps.toString()} />
          <Stat label="Buys / Sells" value={`${profile.stats.buyCount} / ${profile.stats.sellCount}`} />
          <Stat label="Volume" value={formatCompactUsd(profile.stats.volumeUsd)} />
          <Stat label="Followers" value={profile.followerCount.toString()} />
        </div>
        <p className="mt-3 font-body text-xs text-ink-400">
          First seen trading {formatDateTime(profile.stats.firstSeenAt)}
          {profile.stats.lastActiveAt && <> · last active {formatDateTime(profile.stats.lastActiveAt)}</>}
        </p>

        <Surface className="mt-8 p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">Recent activity</h2>
          <ActivityFeed
            initialItems={activity.items}
            initialCursor={activity.nextCursor}
            scope={{ type: 'trader', address: profile.address }}
            emptyTitle="No activity indexed yet."
            emptyDetail={`${truncateAddress(profile.address)} hasn't traded on a tracked market recently.`}
          />
        </Surface>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
