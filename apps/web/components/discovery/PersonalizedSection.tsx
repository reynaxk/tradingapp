'use client';

import { useEffect, useState } from 'react';
import { hasStoredSession } from '@/lib/discovery-client';
import { PersonalizedDiscovery } from './PersonalizedDiscovery';
import { PersonalizedFeed } from './PersonalizedFeed';

/**
 * Wraps the "For you" section as a single unit — checked once, so an anonymous visitor
 * never sees a heading over an empty client component; the whole section simply isn't
 * there, and they see the same public discovery experience everyone gets below. See
 * docs/TRADER_INTELLIGENCE.md#personalized-feed.
 */
export function PersonalizedSection() {
  // Starts false (server-rendered default) and flips true after mount if a session exists
  // — avoids a hydration mismatch, at the cost of one client-only render pass, same
  // tradeoff every session-gated component in this app already makes.
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(hasStoredSession());
  }, []);

  if (!hasSession) return null;

  return (
    <section className="mb-12">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">For you</h2>
      <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
        Tokens and activity picked from who you follow, what you&apos;ve traded, and what&apos;s active on the market
        — see docs/TRADER_INTELLIGENCE.md#personalization for exactly why.
      </p>
      <div className="mt-5">
        <PersonalizedDiscovery />
      </div>
      <div className="mt-5">
        <PersonalizedFeed />
      </div>
    </section>
  );
}
