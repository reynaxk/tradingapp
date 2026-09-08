import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedSearches } from './SavedSearches';

const { hasStoredSession, fetchSavedSearches, createSavedSearch, deleteSavedSearch } = vi.hoisted(
  () => ({
    hasStoredSession: vi.fn(),
    fetchSavedSearches: vi.fn(),
    createSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
  }),
);

vi.mock('@/lib/discovery-client', () => ({
  hasStoredSession,
  fetchSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
}));

describe('SavedSearches', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for a browser with no session', async () => {
    hasStoredSession.mockReturnValue(false);
    const { container } = render(<SavedSearches />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container).toBeEmptyDOMElement();
    expect(fetchSavedSearches).not.toHaveBeenCalled();
  });

  it('lists existing saved searches once loaded', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchSavedSearches.mockResolvedValue([
      {
        id: 's1',
        query: 'pepe',
        displayName: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(<SavedSearches />);

    expect(await screen.findByText('pepe')).toBeInTheDocument();
  });

  it('offers a save button for the current search when it is not already saved', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchSavedSearches.mockResolvedValue([]);

    render(<SavedSearches currentSearch="doge" />);

    expect(await screen.findByText('☆ Save "doge"')).toBeInTheDocument();
  });

  it('does not offer a save button when the current search is already saved', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchSavedSearches.mockResolvedValue([
      {
        id: 's1',
        query: 'doge',
        displayName: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(<SavedSearches currentSearch="doge" />);

    await screen.findByText('doge');
    expect(screen.queryByText(/☆ Save/)).not.toBeInTheDocument();
  });

  it('saving the current search adds it to the list', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchSavedSearches.mockResolvedValue([]);
    createSavedSearch.mockResolvedValue({
      id: 's2',
      query: 'doge',
      displayName: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const user = userEvent.setup();

    render(<SavedSearches currentSearch="doge" />);
    await user.click(await screen.findByText('☆ Save "doge"'));

    expect(createSavedSearch).toHaveBeenCalledWith('doge');
    await waitFor(() => expect(screen.getByText('doge')).toBeInTheDocument());
  });

  it('removing a saved search drops it from the list immediately (instant feel)', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchSavedSearches.mockResolvedValue([
      {
        id: 's1',
        query: 'pepe',
        displayName: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    deleteSavedSearch.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<SavedSearches />);
    await screen.findByText('pepe');
    await user.click(screen.getByRole('button', { name: /remove saved search "pepe"/i }));

    expect(screen.queryByText('pepe')).not.toBeInTheDocument();
    expect(deleteSavedSearch).toHaveBeenCalledWith('s1');
  });
});
