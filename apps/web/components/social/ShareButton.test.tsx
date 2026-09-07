import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareButton } from './ShareButton';

function stubNavigatorShare(impl?: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'share', { value: impl, configurable: true });
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('ShareButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
    stubNavigatorShare(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  describe('when the Web Share API is available', () => {
    beforeEach(() => {
      stubNavigatorShare(vi.fn().mockResolvedValue(undefined));
    });

    it('invokes the native share sheet directly on click, with no dropdown', async () => {
      const user = userEvent.setup();
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await user.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() =>
        expect(navigator.share).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Some token on Fomo' }),
        ),
      );
      expect(screen.queryByText('Copy link')).not.toBeInTheDocument();
    });

    it('shares a URL built from the given path and the current origin', async () => {
      const user = userEvent.setup();
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await user.click(screen.getByRole('button', { name: 'Share' }));

      await waitFor(() =>
        expect(navigator.share).toHaveBeenCalledWith(
          expect.objectContaining({ url: `${window.location.origin}/market/0xabc` }),
        ),
      );
    });

    it('does not treat a cancelled share sheet as an error', async () => {
      stubNavigatorShare(vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
      const user = userEvent.setup();
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await expect(
        user.click(screen.getByRole('button', { name: 'Share' })),
      ).resolves.toBeUndefined();
    });
  });

  describe('when the Web Share API is unavailable — clipboard fallback', () => {
    beforeEach(() => {
      stubNavigatorShare(undefined);
    });

    it('opens a copy-link panel instead of the native share sheet', async () => {
      const user = userEvent.setup();
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await user.click(screen.getByRole('button', { name: 'Share' }));

      expect(await screen.findByText('Copy link')).toBeInTheDocument();
    });

    it('copies the full URL to the clipboard and shows confirmation', async () => {
      // userEvent.setup() installs its own navigator.clipboard stub for copy/paste
      // simulation — stubbing clipboard BEFORE setup() gets silently overwritten by it, so
      // this must stub clipboard AFTER setup(), not before.
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await user.click(screen.getByRole('button', { name: 'Share' }));
      await user.click(await screen.findByText('Copy link'));

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/market/0xabc`),
      );
      expect(await screen.findByText('Copied!')).toBeInTheDocument();
    });

    it('closes the panel on Escape', async () => {
      const user = userEvent.setup();
      render(<ShareButton title="Some token on Fomo" path="/market/0xabc" />);

      await user.click(screen.getByRole('button', { name: 'Share' }));
      expect(await screen.findByText('Copy link')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('Copy link')).not.toBeInTheDocument());
    });
  });
});
