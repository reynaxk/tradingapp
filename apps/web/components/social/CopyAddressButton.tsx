'use client';

import { useState } from 'react';

export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — nothing useful to recover into,
      // the address is still shown in full via the title attribute on the caller.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 font-mono text-xs text-ink-400 transition-colors hover:text-accent"
      title={address}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
