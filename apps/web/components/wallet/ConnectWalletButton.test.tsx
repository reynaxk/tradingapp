import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectWalletButton } from './ConnectWalletButton';

const { useAccount, useConnect, useDisconnect, useSwitchChain } = vi.hoisted(() => ({
  useAccount: vi.fn(),
  useConnect: vi.fn(),
  useDisconnect: vi.fn(),
  useSwitchChain: vi.fn(),
}));

vi.mock('wagmi', () => ({ useAccount, useConnect, useDisconnect, useSwitchChain }));
vi.mock('wagmi/chains', () => ({ base: { id: 8453 } }));

afterEach(() => vi.clearAllMocks());

const ADDRESS = '0x1234567890123456789012345678901234567890';

describe('ConnectWalletButton', () => {
  it('shows "Connect Wallet" and lists available connectors when disconnected', async () => {
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useConnect.mockReturnValue({ connect: vi.fn(), connectors: [{ uid: 'injected', name: 'Injected' }], isPending: false });
    useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));

    expect(screen.getByRole('button', { name: 'Injected' })).toBeInTheDocument();
  });

  it('calls connect with the chosen connector', async () => {
    const connect = vi.fn();
    const connector = { uid: 'injected', name: 'Injected' };
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useConnect.mockReturnValue({ connect, connectors: [connector], isPending: false });
    useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Injected' }));

    expect(connect).toHaveBeenCalledWith({ connector });
  });

  it('shows a "Wrong network" prompt rather than the address when connected off Base', () => {
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 1 });
    useConnect.mockReturnValue({ connect: vi.fn(), connectors: [], isPending: false });
    useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: /wrong network/i })).toBeInTheDocument();
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();
  });

  it('calls switchChain to Base from the wrong-network state', async () => {
    const switchChain = vi.fn();
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 1 });
    useConnect.mockReturnValue({ connect: vi.fn(), connectors: [], isPending: false });
    useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    useSwitchChain.mockReturnValue({ switchChain, isPending: false });

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: /wrong network/i }));

    expect(switchChain).toHaveBeenCalledWith({ chainId: 8453 });
  });

  it('shows the truncated address once connected to the right network', () => {
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    useConnect.mockReturnValue({ connect: vi.fn(), connectors: [], isPending: false });
    useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: '0x1234…7890' })).toBeInTheDocument();
  });

  it('disconnects when the connected button is clicked', async () => {
    const disconnect = vi.fn();
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    useConnect.mockReturnValue({ connect: vi.fn(), connectors: [], isPending: false });
    useDisconnect.mockReturnValue({ disconnect });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: '0x1234…7890' }));

    expect(disconnect).toHaveBeenCalled();
  });
});
