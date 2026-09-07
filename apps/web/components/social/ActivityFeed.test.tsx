import type { SocialActivity } from '@fomo/domain';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed';
import type { RealtimeStatus } from '@/lib/social-client';

const { subscribeToActivityStream, fetchLatestActivity, fetchLatestTraderActivity, fetchLatestFollowingActivity } = vi.hoisted(
  () => ({
    subscribeToActivityStream: vi.fn(),
    fetchLatestActivity: vi.fn(),
    fetchLatestTraderActivity: vi.fn(),
    fetchLatestFollowingActivity: vi.fn(),
  }),
);

vi.mock('@/lib/social-client', () => ({
  subscribeToActivityStream,
  fetchLatestActivity,
  fetchLatestTraderActivity,
  fetchLatestFollowingActivity,
}));

vi.mock('./LikeButton', () => ({ LikeButton: () => null })); // not under test here

function activity(id: string, overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id,
    chainIdentifier: 'eip155:8453',
    trader: { address: '0x1111111111111111111111111111111111aaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: null,
      logoUrl: null,
      decimals: 18,
      quoteAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      quoteSymbol: 'USDC',
      quoteDecimals: 6,
    },
    amountUsd: 100,
    tokenAmount: 1,
    priceUsd: 100,
    timestamp: new Date().toISOString(),
    txHash: `0x${id.padEnd(64, '0')}`,
    chainId: 1,
    social: { likes: 0, likedByMe: null },
    ...overrides,
  };
}

let capturedOnPing: (() => void) | null = null;
let capturedOnStatus: ((status: RealtimeStatus) => void) | null = null;

beforeEach(() => {
  subscribeToActivityStream.mockImplementation((onPing: () => void, onStatus: (s: RealtimeStatus) => void) => {
    capturedOnPing = onPing;
    capturedOnStatus = onStatus;
    return () => {};
  });
});

afterEach(() => {
  vi.clearAllMocks();
  capturedOnPing = null;
  capturedOnStatus = null;
});

describe('ActivityFeed — rendering states', () => {
  it('renders the empty state with no items and no cursor', () => {
    render(<ActivityFeed initialItems={[]} initialCursor={null} scope={{ type: 'global' }} emptyTitle="Nothing yet." />);
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
  });

  it('renders one card per initial item', () => {
    render(
      <ActivityFeed initialItems={[activity('a'), activity('b')]} initialCursor={null} scope={{ type: 'global' }} />,
    );
    expect(screen.getAllByText('Bought')).toHaveLength(2);
  });

  it('shows a "Load more" button only when a cursor is present', () => {
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor="cursor-1" scope={{ type: 'global' }} />);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('shows no "Load more" button when there is no cursor', () => {
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor={null} scope={{ type: 'global' }} />);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('ActivityFeed — realtime status', () => {
  it('starts in "Connecting…" and reflects live/reconnecting status changes', async () => {
    render(<ActivityFeed initialItems={[]} initialCursor={null} scope={{ type: 'global' }} />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();

    act(() => capturedOnStatus?.('live'));
    expect(await screen.findByText('Live')).toBeInTheDocument();

    act(() => capturedOnStatus?.('reconnecting'));
    expect(await screen.findByText(/reconnecting/i)).toBeInTheDocument();
  });

  it('does not subscribe to the stream at all when live=false', () => {
    render(<ActivityFeed initialItems={[]} initialCursor={null} scope={{ type: 'trader', address: '0xabc' }} live={false} />);
    expect(subscribeToActivityStream).not.toHaveBeenCalled();
  });
});

describe('ActivityFeed — new activity reveal', () => {
  it('shows a "N new" pill after a ping, and reveals only genuinely new items on click without disturbing existing ones', async () => {
    fetchLatestActivity.mockResolvedValue({ items: [activity('new-1'), activity('a')], nextCursor: null });
    const user = userEvent.setup();
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor={null} scope={{ type: 'global' }} />);

    expect(screen.queryByText(/new trade/)).not.toBeInTheDocument();
    act(() => capturedOnPing?.());
    expect(await screen.findByText('1 new trade')).toBeInTheDocument();

    await user.click(screen.getByText('1 new trade'));

    await waitFor(() => expect(screen.getAllByText('Bought')).toHaveLength(2)); // "a" deduped, "new-1" added
    expect(screen.queryByText(/new trade/)).not.toBeInTheDocument();
  });

  it('routes the reveal fetch through the trader-scoped fetcher when scope is a trader', async () => {
    fetchLatestTraderActivity.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor={null} scope={{ type: 'trader', address: '0xabc' }} />);

    act(() => capturedOnPing?.());
    await user.click(await screen.findByText('1 new trade'));

    await waitFor(() => expect(fetchLatestTraderActivity).toHaveBeenCalledWith('0xabc', { cursor: undefined, limit: 20 }));
    expect(fetchLatestActivity).not.toHaveBeenCalled();
  });

  it('leaves the pill up for the user to retry when the reveal fetch fails', async () => {
    fetchLatestActivity.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor={null} scope={{ type: 'global' }} />);

    act(() => capturedOnPing?.());
    await user.click(await screen.findByText('1 new trade'));

    await waitFor(() => expect(fetchLatestActivity).toHaveBeenCalled());
    expect(screen.getByText('1 new trade')).toBeInTheDocument(); // still there — nothing silently succeeded
  });
});

describe('ActivityFeed — load more', () => {
  it('appends the next page and advances the cursor', async () => {
    fetchLatestActivity.mockResolvedValue({ items: [activity('b')], nextCursor: null });
    const user = userEvent.setup();
    render(<ActivityFeed initialItems={[activity('a')]} initialCursor="cursor-1" scope={{ type: 'global' }} />);

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getAllByText('Bought')).toHaveLength(2));
    expect(fetchLatestActivity).toHaveBeenCalledWith({ cursor: 'cursor-1', limit: 20 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(); // nextCursor was null
  });
});
