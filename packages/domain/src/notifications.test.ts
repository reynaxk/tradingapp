import { describe, expect, it } from 'vitest';
import {
  followDedupeKey,
  followedTraderTradeDedupeKey,
  likeDedupeKey,
  notificationDeepLink,
  NOTIFICATION_PREFERENCE_FIELD,
  NotificationDtoSchema,
  trendingTokenDedupeKey,
  watchedTokenActivityDedupeKey,
  whaleTradeDedupeKey,
} from './notifications';

describe('dedupe keys', () => {
  it('followDedupeKey ignores which follow occurrence produced it — unfollow/refollow must not renotify', () => {
    expect(followDedupeKey('user-1')).toBe(followDedupeKey('user-1'));
  });

  it('followDedupeKey differs per follower', () => {
    expect(followDedupeKey('user-1')).not.toBe(followDedupeKey('user-2'));
  });

  it('likeDedupeKey is scoped to both the liker and the specific swap liked', () => {
    const a = likeDedupeKey('user-1', 'swap-1');
    expect(a).not.toBe(likeDedupeKey('user-2', 'swap-1')); // different liker, same swap
    expect(a).not.toBe(likeDedupeKey('user-1', 'swap-2')); // same liker, different swap
    expect(a).toBe(likeDedupeKey('user-1', 'swap-1')); // identical inputs -> identical key
  });

  it('followedTraderTradeDedupeKey and whaleTradeDedupeKey are keyed on the swap alone — one notification per real trade, no matter how many times fan-out is retried', () => {
    expect(followedTraderTradeDedupeKey('swap-1')).toBe(followedTraderTradeDedupeKey('swap-1'));
    expect(whaleTradeDedupeKey('swap-1')).toBe(whaleTradeDedupeKey('swap-1'));
  });

  it('watchedTokenActivityDedupeKey is keyed on the swap alone, same as whaleTradeDedupeKey — the (userId, type, dedupeKey) unique constraint is what keeps the two notification types independent', () => {
    expect(watchedTokenActivityDedupeKey('swap-1')).toBe(watchedTokenActivityDedupeKey('swap-1'));
    expect(watchedTokenActivityDedupeKey('swap-1')).not.toBe(
      watchedTokenActivityDedupeKey('swap-2'),
    );
  });

  it('trendingTokenDedupeKey is scoped to one specific transition, so a later re-entry can notify again', () => {
    const first = trendingTokenDedupeKey('market-1', '2026-01-01T00:00:00.000Z');
    const second = trendingTokenDedupeKey('market-1', '2026-02-01T00:00:00.000Z');
    expect(first).not.toBe(second);
    expect(trendingTokenDedupeKey('market-1', '2026-01-01T00:00:00.000Z')).toBe(first);
  });
});

describe('notificationDeepLink', () => {
  it("FOLLOW links to the actor's existing trader profile route", () => {
    expect(
      notificationDeepLink('FOLLOW', { actorWalletAddress: '0xabc', tokenAddress: null }),
    ).toBe('/trader/0xabc');
  });

  it('FOLLOW has no link when the actor has no wallet at all', () => {
    expect(
      notificationDeepLink('FOLLOW', { actorWalletAddress: null, tokenAddress: null }),
    ).toBeNull();
  });

  it.each([
    'LIKE',
    'FOLLOWED_TRADER_TRADE',
    'WHALE_TRADE',
    'TRENDING_TOKEN',
    'WATCHED_TOKEN_ACTIVITY',
  ] as const)('%s links to the existing market route for the referenced token', (type) => {
    expect(notificationDeepLink(type, { actorWalletAddress: null, tokenAddress: '0xtoken' })).toBe(
      '/market/0xtoken',
    );
  });

  it('has no link when nothing to point to is available', () => {
    expect(
      notificationDeepLink('TRENDING_TOKEN', { actorWalletAddress: null, tokenAddress: null }),
    ).toBeNull();
  });
});

describe('NOTIFICATION_PREFERENCE_FIELD', () => {
  it('maps every notification type to a preference field', () => {
    const types = [
      'FOLLOW',
      'LIKE',
      'FOLLOWED_TRADER_TRADE',
      'WHALE_TRADE',
      'TRENDING_TOKEN',
      'WATCHED_TOKEN_ACTIVITY',
    ] as const;
    for (const type of types) {
      expect(NOTIFICATION_PREFERENCE_FIELD[type]).toBeTruthy();
    }
  });
});

describe('NotificationDtoSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'FOLLOW' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    readAt: null,
    actor: { address: '0xabc', displayName: null, avatarUrl: null },
    token: null,
    amountUsd: null,
    side: null,
    deepLink: '/trader/0xabc',
  };

  it('accepts a well-formed notification', () => {
    expect(NotificationDtoSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a null actor address (actor exists but has no linked wallet)', () => {
    const result = NotificationDtoSchema.safeParse({
      ...base,
      actor: { address: null, displayName: null, avatarUrl: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown notification type', () => {
    const result = NotificationDtoSchema.safeParse({ ...base, type: 'SOMETHING_ELSE' });
    expect(result.success).toBe(false);
  });
});
