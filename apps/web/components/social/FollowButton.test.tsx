import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowButton } from './FollowButton';

const { followTrader, unfollowTrader, checkFollowStatus } = vi.hoisted(() => ({
  followTrader: vi.fn(),
  unfollowTrader: vi.fn(),
  checkFollowStatus: vi.fn(),
}));

vi.mock('@/lib/social-client', () => ({ followTrader, unfollowTrader, checkFollowStatus }));

const ADDRESS = '0x1111111111111111111111111111111111aaaa';

describe('FollowButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Follow" when known not to be following', () => {
    render(<FollowButton address={ADDRESS} initialFollowing={false} />);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('renders "Following" when known to already be following', () => {
    render(<FollowButton address={ADDRESS} initialFollowing />);
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument();
  });

  it('resolves the real state client-side when the server render could not know it', async () => {
    checkFollowStatus.mockResolvedValue(true);
    render(<FollowButton address={ADDRESS} initialFollowing={null} />);

    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument(); // optimistic default
    await waitFor(() => expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument());
    expect(checkFollowStatus).toHaveBeenCalledWith(ADDRESS);
  });

  it('clicking Follow calls followTrader and flips to Following', async () => {
    followTrader.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FollowButton address={ADDRESS} initialFollowing={false} />);

    await user.click(screen.getByRole('button', { name: 'Follow' }));

    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument();
    await waitFor(() => expect(followTrader).toHaveBeenCalledWith(ADDRESS));
  });

  it('clicking Following calls unfollowTrader and flips back to Follow', async () => {
    unfollowTrader.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FollowButton address={ADDRESS} initialFollowing />);

    await user.click(screen.getByRole('button', { name: 'Following' }));

    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
    await waitFor(() => expect(unfollowTrader).toHaveBeenCalledWith(ADDRESS));
  });

  it('rolls back to Follow and shows an error when the follow request fails', async () => {
    followTrader.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<FollowButton address={ADDRESS} initialFollowing={false} />);

    await user.click(screen.getByRole('button', { name: 'Follow' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument());
    expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
  });
});
