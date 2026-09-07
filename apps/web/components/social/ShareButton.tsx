'use client';

import { Surface } from '@fomo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * Copy link + the native Web Share API where the browser has one — see
 * docs/PHASE6_RETENTION_SOCIAL.md#shareable-activity-cards. No social-media API integrations, no
 * image generation, no server-side screenshot rendering (explicitly out of scope): this
 * shares a link to the same public page anyone else can already reach unauthenticated.
 * Reuses NotificationBell's own self-contained toggle-dropdown pattern (outside-click +
 * Escape both close it) for the copy-link fallback panel.
 */
export function ShareButton({
  title,
  path,
  text,
  compact = false,
  className,
}: {
  title: string;
  path: string;
  text?: string;
  /** A smaller icon for dense contexts (activity cards) — same size as LikeButton next to it. */
  compact?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Starts false (server-rendered default, where `navigator` doesn't exist) and resolves
  // after mount — same hydration-safe pattern PersonalizedSection uses for session state.
  const [canNativeShare, setCanNativeShare] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  function shareUrl(): string {
    return `${window.location.origin}${path}`;
  }

  async function onClick() {
    if (canNativeShare) {
      try {
        await navigator.share({ title, text, url: shareUrl() });
      } catch {
        // Cancelled the native share sheet, or the platform rejected it — not an error worth
        // surfacing; the user simply didn't complete a share.
      }
      return;
    }
    setIsOpen((open) => !open);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard unavailable/denied — the panel just stays open
    }
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => void onClick()}
        aria-haspopup={canNativeShare ? undefined : 'true'}
        aria-expanded={canNativeShare ? undefined : isOpen}
        aria-label="Share"
        title="Share"
        className={
          compact
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
            : 'inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-surface-raised hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
        }
      >
        <ShareIcon small={compact} />
      </button>

      {isOpen && !canNativeShare && (
        <Surface
          aria-label="Share options"
          className={`absolute right-0 z-20 w-48 p-1.5 shadow-lg ${compact ? 'top-9' : 'top-11'}`}
        >
          <button
            type="button"
            onClick={() => void copyLink()}
            className="block w-full rounded-lg px-3 py-2 text-left font-body text-sm text-ink-900 hover:bg-surface-raised"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </Surface>
      )}
    </div>
  );
}

function ShareIcon({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
      <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
    </svg>
  );
}
