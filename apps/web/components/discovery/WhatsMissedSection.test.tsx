import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsMissedSection } from './WhatsMissedSection';

const { hasStoredSession, fetchWhatsMissed, markDiscoverySeen } = vi.hoisted(() => ({
  hasStoredSession: vi.fn(),
  fetchWhatsMissed: vi.fn(),
  markDiscoverySeen: vi.fn(),
}));

vi.mock('@/lib/discovery-client', () => ({
  hasStoredSession,
  fetchWhatsMissed,
  markDiscoverySeen,
}));

describe('WhatsMissedSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for a browser with no session — never fetching', async () => {
    hasStoredSession.mockReturnValue(false);
    const { container } = render(<WhatsMissedSection />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container).toBeEmptyDOMElement();
    expect(fetchWhatsMissed).not.toHaveBeenCalled();
  });

  it('renders nothing when there is nothing new — a quiet product, not a nagging one', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWhatsMissed.mockResolvedValue({
      items: [],
      totalUnseen: 0,
      currentStreakDays: 1,
      longestStreakDays: 1,
    });
    markDiscoverySeen.mockResolvedValue({ currentStreakDays: 1, longestStreakDays: 1 });

    const { container } = render(<WhatsMissedSection />);

    await waitFor(() => expect(fetchWhatsMissed).toHaveBeenCalled());
    await waitFor(() => expect(markDiscoverySeen).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unseen count when something happened since the last visit', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWhatsMissed.mockResolvedValue({
      items: [],
      totalUnseen: 3,
      currentStreakDays: 2,
      longestStreakDays: 5,
    });
    markDiscoverySeen.mockResolvedValue({ currentStreakDays: 2, longestStreakDays: 5 });

    render(<WhatsMissedSection />);

    expect(await screen.findByText(/3 things/)).toBeInTheDocument();
  });

  it('shows the streak once it clears 1 day', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWhatsMissed.mockResolvedValue({
      items: [],
      totalUnseen: 1,
      currentStreakDays: 4,
      longestStreakDays: 5,
    });
    markDiscoverySeen.mockResolvedValue({ currentStreakDays: 4, longestStreakDays: 5 });

    render(<WhatsMissedSection />);

    expect(await screen.findByText(/4-day streak/)).toBeInTheDocument();
  });

  it('never shows a 1-day streak as a streak — nothing to celebrate on day one', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWhatsMissed.mockResolvedValue({
      items: [],
      totalUnseen: 2,
      currentStreakDays: 1,
      longestStreakDays: 1,
    });
    markDiscoverySeen.mockResolvedValue({ currentStreakDays: 1, longestStreakDays: 1 });

    render(<WhatsMissedSection />);

    await screen.findByText(/2 things/);
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
  });

  it("calls markDiscoverySeen after reading whatsMissed, so this visit's items reflect the *previous* seen point", async () => {
    hasStoredSession.mockReturnValue(true);
    const order: string[] = [];
    fetchWhatsMissed.mockImplementation(async () => {
      order.push('fetch');
      return { items: [], totalUnseen: 1, currentStreakDays: 1, longestStreakDays: 1 };
    });
    markDiscoverySeen.mockImplementation(async () => {
      order.push('mark');
      return { currentStreakDays: 1, longestStreakDays: 1 };
    });

    render(<WhatsMissedSection />);

    await waitFor(() => expect(order).toEqual(['fetch', 'mark']));
  });
});
