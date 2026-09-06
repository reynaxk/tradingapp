import { describe, expect, it } from 'vitest';
import { buildSiweMessage } from './wallet-auth';

describe('buildSiweMessage', () => {
  const base = {
    domain: 'fomo.app',
    address: '0x1111111111111111111111111111111111aaaa',
    statement: 'Sign in to Fomo to verify wallet ownership.',
    uri: 'https://fomo.app',
    chainId: 8453,
    nonce: 'abc123nonce',
    issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    expirationTime: new Date('2026-01-01T12:05:00.000Z'),
  };

  it('renders every EIP-4361 field in the exact expected order', () => {
    const message = buildSiweMessage(base);
    expect(message).toBe(
      [
        'fomo.app wants you to sign in with your Ethereum account:',
        '0x1111111111111111111111111111111111aaaa',
        '',
        'Sign in to Fomo to verify wallet ownership.',
        '',
        'URI: https://fomo.app',
        'Version: 1',
        'Chain ID: 8453',
        'Nonce: abc123nonce',
        'Issued At: 2026-01-01T12:00:00.000Z',
        'Expiration Time: 2026-01-01T12:05:00.000Z',
      ].join('\n'),
    );
  });

  it('is deterministic — identical params always produce an identical message', () => {
    expect(buildSiweMessage(base)).toBe(buildSiweMessage({ ...base }));
  });

  it('changes byte-for-byte when the nonce changes, so two challenges are never confusable', () => {
    const a = buildSiweMessage(base);
    const b = buildSiweMessage({ ...base, nonce: 'different-nonce' });
    expect(a).not.toBe(b);
  });

  it('embeds the chain id, so a message can never be replayed as a valid sign-in for another chain', () => {
    const message = buildSiweMessage({ ...base, chainId: 1 });
    expect(message).toContain('Chain ID: 1');
    expect(message).not.toContain('Chain ID: 8453');
  });
});
