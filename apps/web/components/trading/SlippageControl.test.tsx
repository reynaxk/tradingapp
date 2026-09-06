import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRADING_DEFAULTS } from '@fomo/domain';
import { SlippageControl } from './SlippageControl';

afterEach(() => vi.clearAllMocks());

describe('SlippageControl', () => {
  it('highlights the preset matching the current value', () => {
    render(<SlippageControl valueBps={50} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '0.5%' })).toHaveClass('bg-accent');
  });

  it('calls onChange with the preset bps when a preset is clicked', async () => {
    const onChange = vi.fn();
    render(<SlippageControl valueBps={50} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '1%' }));

    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('never calls onChange once a custom value goes out of the valid slippage bounds', async () => {
    const onChange = vi.fn();
    render(<SlippageControl valueBps={50} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const input = screen.getByPlaceholderText(`${TRADING_DEFAULTS.minSlippageBps / 100}–${TRADING_DEFAULTS.maxSlippageBps / 100}`);
    await userEvent.type(input, '999'); // 99900 bps — far past maxSlippageBps

    for (const call of onChange.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(TRADING_DEFAULTS.maxSlippageBps);
    }
    expect(onChange).not.toHaveBeenLastCalledWith(99_900);
  });

  it('calls onChange for a valid custom value', async () => {
    const onChange = vi.fn();
    render(<SlippageControl valueBps={50} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const input = screen.getByPlaceholderText(`${TRADING_DEFAULTS.minSlippageBps / 100}–${TRADING_DEFAULTS.maxSlippageBps / 100}`);
    await userEvent.type(input, '2');

    expect(onChange).toHaveBeenLastCalledWith(200);
  });

  it('shows a sandwich-attack warning above the UI heuristic threshold', () => {
    render(<SlippageControl valueBps={500} onChange={vi.fn()} />);
    expect(screen.getByText(/sandwich attacks/i)).toBeInTheDocument();
  });

  it('shows no warning at the default slippage', () => {
    render(<SlippageControl valueBps={TRADING_DEFAULTS.defaultSlippageBps} onChange={vi.fn()} />);
    expect(screen.queryByText(/sandwich attacks/i)).not.toBeInTheDocument();
  });
});
