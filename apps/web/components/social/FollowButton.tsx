'use client';

import { Button } from '@fomo/ui';
import { useEffect, useState, useTransition } from 'react';
import { checkFollowStatus, followTrader, unfollowTrader } from '@/lib/social-client';

/**
 * `initialFollowing` from a server-rendered page is always `null` in practice — the
 * browser's session lives in localStorage, never a cookie, so a Server Component can never
 * see it (see docs/SOCIAL.md#authentication). When it's `null`, resolve the real state
 * once mounted using whatever session this browser already has, without creating a new
 * one just to check. Optimistic toggle, rolled back on failure rather than left in a state
 * the server never confirmed.
 */
export function FollowButton({
  address,
  initialFollowing,
  className,
}: {
  address: string;
  initialFollowing: boolean | null;
  className?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing === true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initialFollowing !== null) return;
    let cancelled = false;
    checkFollowStatus(address).then((isFollowing) => {
      if (!cancelled) setFollowing(isFollowing);
    });
    return () => {
      cancelled = true;
    };
  }, [address, initialFollowing]);

  const toggle = () => {
    const next = !following;
    setFollowing(next);
    setError(false);
    startTransition(async () => {
      try {
        await (next ? followTrader(address) : unfollowTrader(address));
      } catch {
        setFollowing(!next); // roll back — the server never confirmed this state
        setError(true);
      }
    });
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant={following ? 'secondary' : 'primary'}
        onClick={toggle}
        disabled={isPending}
        aria-pressed={following}
        className="min-w-[6.5rem]"
      >
        {following ? 'Following' : 'Follow'}
      </Button>
      {error && <p className="mt-1 font-body text-xs text-down">Couldn&apos;t save that — try again.</p>}
    </div>
  );
}
