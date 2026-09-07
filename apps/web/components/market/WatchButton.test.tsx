import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WatchButton } from './WatchButton';

const { watchToken, unwatchToken, checkWatchStatus } = vi.hoisted(() => ({
  watchToken: vi.fn(),
  unwatchToken: vi.fn(),
  checkWatchStatus: vi.fn(),
}));

vi.mock('@/lib/watchlist-client', () => ({ watchToken, unwatchToken, checkWatchStatus }));

const ADDRESS = '0x1111111111111111111111111111111111aaaa';

describe('WatchButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Watch" when known not to be watching', () => {
    render(<WatchButton address={ADDRESS} initialWatching={false} />);
    expect(screen.getByRole('button', { name: /watch/i })).toHaveTextContent('Watch');
  });

  it('renders "Watching" when known to already be watching', () => {
    render(<WatchButton address={ADDRESS} initialWatching />);
    expect(screen.getByRole('button')).toHaveTextContent('Watching');
  });

  it('resolves the real state client-side when the server render could not know it', async () => {
    checkWatchStatus.mockResolvedValue(true);
    render(<WatchButton address={ADDRESS} initialWatching={null} />);

    expect(screen.getByRole('button')).toHaveTextContent('Watch');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Watching'));
    expect(checkWatchStatus).toHaveBeenCalledWith(ADDRESS);
  });

  it('clicking Watch calls watchToken and flips to Watching (optimistic)', async () => {
    watchToken.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WatchButton address={ADDRESS} initialWatching={false} />);

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('Watching');
    await waitFor(() => expect(watchToken).toHaveBeenCalledWith(ADDRESS));
  });

  it('clicking Watching calls unwatchToken and flips back to Watch', async () => {
    unwatchToken.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WatchButton address={ADDRESS} initialWatching />);

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('Watch');
    await waitFor(() => expect(unwatchToken).toHaveBeenCalledWith(ADDRESS));
  });

  it('rolls back to Watch and shows an error when the watch request fails', async () => {
    watchToken.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<WatchButton address={ADDRESS} initialWatching={false} />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Watch'));
    expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
  });

  it('calls onChange with the confirmed (not optimistic) next state on success', async () => {
    watchToken.mockResolvedValue(undefined);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WatchButton address={ADDRESS} initialWatching={false} onChange={onChange} />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  });

  it('never calls onChange when the mutation fails', async () => {
    watchToken.mockRejectedValue(new Error('network error'));
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WatchButton address={ADDRESS} initialWatching={false} onChange={onChange} />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('compact variant', () => {
    it('renders as an icon-only star with a real accessible name — never icon-only for a screen reader', () => {
      render(<WatchButton address={ADDRESS} initialWatching={false} compact />);
      expect(screen.getByRole('button', { name: `Watch ${ADDRESS}` })).toBeInTheDocument();
    });

    it('reflects watching state in its accessible name too', () => {
      render(<WatchButton address={ADDRESS} initialWatching compact />);
      expect(screen.getByRole('button', { name: `Stop watching ${ADDRESS}` })).toBeInTheDocument();
    });
  });
});
