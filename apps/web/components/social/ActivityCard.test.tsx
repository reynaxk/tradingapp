import type { SocialActivity } from '@fomo/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityCard } from './ActivityCard';

vi.mock('@/lib/social-client', () => ({
  likeActivity: vi.fn(),
  unlikeActivity: vi.fn(),
}));

function buildActivity(overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainIdentifier: 'eip155:8453',
    trader: { address: '0x1111111111111111111111111111111111aaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      logoUrl: null,
      decimals: 18,
      quoteAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      quoteSymbol: 'USDC',
      quoteDecimals: 6,
    },
    amountUsd: 2431.42,
    tokenAmount: 0.99,
    priceUsd: 2455.23,
    timestamp: new Date().toISOString(),
    txHash: '0xabc0000000000000000000000000000000000000000000000000000000ab',
    chainId: 1,
    social: { likes: 3, likedByMe: false },
    ...overrides,
  };
}

describe('ActivityCard', () => {
  it('renders a buy in the up color with the trader, amount, and token', () => {
    render(<ActivityCard activity={buildActivity()} />);
    expect(screen.getByText('Bought')).toBeInTheDocument();
    expect(screen.getByText('$2.4K')).toBeInTheDocument();
    expect(screen.getByText('WETH')).toBeInTheDocument();
    expect(screen.getByText('0x1111…aaaa')).toBeInTheDocument();
  });

  it('renders a sell distinctly from a buy', () => {
    render(<ActivityCard activity={buildActivity({ action: 'SELL' })} />);
    expect(screen.getByText('Sold')).toBeInTheDocument();
    expect(screen.queryByText('Bought')).not.toBeInTheDocument();
  });

  it('shows "Unknown trader" rather than a fabricated identity for a pre-Phase-2 swap', () => {
    render(<ActivityCard activity={buildActivity({ trader: { address: null, displayName: null, avatarUrl: null } })} />);
    expect(screen.getByText('Unknown trader')).toBeInTheDocument();
  });

  it('shows a display name when the trader has one, alongside the address', () => {
    render(
      <ActivityCard
        activity={buildActivity({
          trader: { address: '0x1111111111111111111111111111111111aaaa', displayName: 'Alex', avatarUrl: null },
        })}
      />,
    );
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('renders the like count from the activity, not a hardcoded value', () => {
    render(<ActivityCard activity={buildActivity({ social: { likes: 42, likedByMe: true } })} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
