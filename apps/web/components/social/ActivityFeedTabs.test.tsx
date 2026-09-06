import type { SocialActivity } from '@fomo/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityFeedTabs } from './ActivityFeedTabs';

const { fetchLatestFollowingActivity, hasStoredSession, subscribeToActivityStream } = vi.hoisted(() => ({
  fetchLatestFollowingActivity: vi.fn(),
  hasStoredSession: vi.fn(),
  subscribeToActivityStream: vi.fn(() => () => {}),
}));

vi.mock('@/lib/social-client', () => ({ fetchLatestFollowingActivity, hasStoredSession, subscribeToActivityStream }));
vi.mock('./LikeButton', () => ({ LikeButton: () => null }));

function activity(id: string): SocialActivity {
  return {
    id,
    chainIdentifier: 'eip155:8453',
    trader: { address: '0x1111111111111111111111111111111111aaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: null, logoUrl: null },
    amountUsd: 100,
    tokenAmount: 1,
    priceUsd: 100,
    timestamp: new Date().toISOString(),
    txHash: `0x${id.padEnd(64, '0')}`,
    chainId: 1,
    social: { likes: 0, likedByMe: null },
  };
}

describe('ActivityFeedTabs', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the global feed by default without touching the following endpoint', () => {
    render(<ActivityFeedTabs globalItems={[activity('a')]} globalCursor={null} />);
    expect(screen.getByText('Bought')).toBeInTheDocument();
    expect(fetchLatestFollowingActivity).not.toHaveBeenCalled();
  });

  it('shows an honest empty state for the Following tab when no session exists yet — never silently creating one', async () => {
    hasStoredSession.mockReturnValue(false);
    const user = userEvent.setup();
    render(<ActivityFeedTabs globalItems={[]} globalCursor={null} />);

    await user.click(screen.getByRole('tab', { name: 'Following' }));

    expect(await screen.findByText("You're not following anyone yet.")).toBeInTheDocument();
    expect(fetchLatestFollowingActivity).not.toHaveBeenCalled();
  });

  it('fetches and renders the following feed when a session already exists', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchLatestFollowingActivity.mockResolvedValue({ items: [activity('f1')], nextCursor: null });
    const user = userEvent.setup();
    render(<ActivityFeedTabs globalItems={[]} globalCursor={null} />);

    await user.click(screen.getByRole('tab', { name: 'Following' }));

    await waitFor(() => expect(fetchLatestFollowingActivity).toHaveBeenCalledWith({ limit: 20 }));
    expect(await screen.findByText('Bought')).toBeInTheDocument();
  });

  it('shows a retry-worthy error state when the following feed fails to load', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchLatestFollowingActivity.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<ActivityFeedTabs globalItems={[]} globalCursor={null} />);

    await user.click(screen.getByRole('tab', { name: 'Following' }));

    expect(await screen.findByText("Couldn't load your feed.")).toBeInTheDocument();
  });
});
