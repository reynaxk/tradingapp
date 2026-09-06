'use client';

import { cn } from '@fomo/ui';
import { useState, useTransition } from 'react';
import { likeActivity, unlikeActivity } from '@/lib/social-client';

export function LikeButton({
  activityId,
  initialLikes,
  initialLikedByMe,
}: {
  activityId: string;
  initialLikes: number;
  initialLikedByMe: boolean | null;
}) {
  const [liked, setLiked] = useState(initialLikedByMe === true);
  const [likes, setLikes] = useState(initialLikes);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !liked;
    setLiked(next);
    setLikes((count) => Math.max(0, count + (next ? 1 : -1)));
    startTransition(async () => {
      try {
        await (next ? likeActivity(activityId) : unlikeActivity(activityId));
      } catch {
        setLiked(!next); // roll back — the server never confirmed this state
        setLikes((count) => Math.max(0, count + (next ? -1 : 1)));
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike' : 'Like'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-xs tabular-nums transition-colors',
        liked ? 'text-accent' : 'text-ink-400 hover:text-ink-900',
      )}
    >
      <span aria-hidden>{liked ? '♥' : '♡'}</span>
      {likes}
    </button>
  );
}
