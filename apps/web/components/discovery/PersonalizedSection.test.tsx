import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalizedSection } from './PersonalizedSection';

const { hasStoredSession, fetchPersonalizedDiscovery, fetchPersonalizedFeed, subscribeToActivityStream } = vi.hoisted(() => ({
  hasStoredSession: vi.fn(),
  fetchPersonalizedDiscovery: vi.fn(),
  fetchPersonalizedFeed: vi.fn(),
  subscribeToActivityStream: vi.fn(() => () => {}),
}));

vi.mock('@/lib/discovery-client', () => ({ hasStoredSession, fetchPersonalizedDiscovery, fetchPersonalizedFeed }));
vi.mock('@/lib/social-client', () => ({ subscribeToActivityStream }));

describe('PersonalizedSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing at all for a browser with no session — never fetching, never showing an empty "For you" shell', async () => {
    hasStoredSession.mockReturnValue(false);
    const { container } = render(<PersonalizedSection />);

    // useEffect runs after the initial render; give it a tick, then assert the section
    // never appeared and neither personalized endpoint was ever called.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container).toBeEmptyDOMElement();
    expect(fetchPersonalizedDiscovery).not.toHaveBeenCalled();
    expect(fetchPersonalizedFeed).not.toHaveBeenCalled();
  });

  it('renders the "For you" section once a session is confirmed to exist', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([]);
    fetchPersonalizedFeed.mockResolvedValue({ items: [], nextCursor: null });

    render(<PersonalizedSection />);

    expect(await screen.findByText('For you')).toBeInTheDocument();
  });
});
