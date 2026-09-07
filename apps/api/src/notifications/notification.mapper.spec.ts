import { toNotificationDto, type NotificationRow } from './notification.mapper';

const BASE: NotificationRow = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: 'user-1',
  type: 'FOLLOW',
  dedupeKey: 'k',
  actorUserId: null,
  actorWalletAddress: null,
  swapId: null,
  tokenMarketId: null,
  readAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  actorUser: null,
  actorWallet: null,
  swap: null,
  tokenMarket: null,
} as unknown as NotificationRow;

describe('toNotificationDto', () => {
  it('resolves the actor directly from actorWallet when present (FOLLOWED_TRADER_TRADE/WHALE_TRADE shape)', () => {
    const row = {
      ...BASE,
      type: 'WHALE_TRADE',
      actorWalletAddress: '0xtrader',
      actorWallet: { address: '0xtrader', displayName: 'Whale', avatarUrl: null },
      swap: {
        volumeUsd: { toString: () => '50000' } as unknown as number,
        side: 'buy',
        tokenMarket: { token: { contractAddress: '0xtoken', symbol: 'FOO', logoUrl: null } },
      },
    } as unknown as NotificationRow;

    const dto = toNotificationDto(row);

    expect(dto.actor).toEqual({ address: '0xtrader', displayName: 'Whale', avatarUrl: null });
    expect(dto.token).toEqual({ address: '0xtoken', symbol: 'FOO', logoUrl: null });
    expect(dto.side).toBe('BUY');
    expect(dto.deepLink).toBe('/market/0xtoken');
  });

  it('falls back to the actor user\'s earliest-verified wallet when there is no direct actorWallet (FOLLOW/LIKE shape)', () => {
    const row = {
      ...BASE,
      type: 'FOLLOW',
      actorUserId: 'actor-1',
      actorUser: { wallets: [{ address: '0xactor', displayName: 'Alex', avatarUrl: 'a.png' }] },
    } as unknown as NotificationRow;

    const dto = toNotificationDto(row);

    expect(dto.actor).toEqual({ address: '0xactor', displayName: 'Alex', avatarUrl: 'a.png' });
    expect(dto.deepLink).toBe('/trader/0xactor');
  });

  it('renders a null actor (not a crash) when the acting user has no verified wallet at all', () => {
    const row = { ...BASE, type: 'FOLLOW', actorUserId: 'actor-1', actorUser: { wallets: [] } } as unknown as NotificationRow;

    const dto = toNotificationDto(row);

    expect(dto.actor).toEqual({ address: null, displayName: null, avatarUrl: null });
    expect(dto.deepLink).toBeNull();
  });

  it('has no actor at all for TRENDING_TOKEN, and resolves its token from tokenMarket directly (no swap)', () => {
    const row = {
      ...BASE,
      type: 'TRENDING_TOKEN',
      tokenMarketId: 'tm-1',
      tokenMarket: { token: { contractAddress: '0xtoken', symbol: 'FOO', logoUrl: null } },
    } as unknown as NotificationRow;

    const dto = toNotificationDto(row);

    expect(dto.actor).toBeNull();
    expect(dto.amountUsd).toBeNull();
    expect(dto.side).toBeNull();
    expect(dto.token).toEqual({ address: '0xtoken', symbol: 'FOO', logoUrl: null });
    expect(dto.deepLink).toBe('/market/0xtoken');
  });

  it('surfaces readAt as an ISO string when set, and null when unread', () => {
    const unread = toNotificationDto(BASE);
    expect(unread.readAt).toBeNull();

    const read = { ...BASE, readAt: new Date('2026-01-02T00:00:00.000Z') } as unknown as NotificationRow;
    expect(toNotificationDto(read).readAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
