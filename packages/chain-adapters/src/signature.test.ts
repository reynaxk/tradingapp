import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { verifyEvmSignature } from './signature';

// A well-known, public test-only private key (Hardhat/Anvil's default account #0) — never
// a real, funded wallet. Used only to produce a real signature these tests can verify.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('verifyEvmSignature', () => {
  it('accepts a real signature from the address that actually signed it', async () => {
    const message = 'fomo.app wants you to sign in with your Ethereum account';
    const signature = await account.signMessage({ message });

    await expect(verifyEvmSignature({ address: account.address, message, signature })).resolves.toBe(true);
  });

  it('rejects a valid signature checked against a different message than what was signed', async () => {
    const signature = await account.signMessage({ message: 'original message' });

    await expect(
      verifyEvmSignature({ address: account.address, message: 'tampered message', signature }),
    ).resolves.toBe(false);
  });

  it("rejects a valid signature checked against an address that isn't the signer", async () => {
    const message = 'fomo.app sign-in';
    const signature = await account.signMessage({ message });
    const someoneElse = '0x000000000000000000000000000000000000dEaD';

    await expect(verifyEvmSignature({ address: someoneElse, message, signature })).resolves.toBe(false);
  });

  it('returns false, never throws, for a structurally malformed signature', async () => {
    await expect(
      verifyEvmSignature({ address: account.address, message: 'x', signature: '0xnotarealsignature' }),
    ).resolves.toBe(false);
  });

  it('returns false, never throws, for a malformed address', async () => {
    const signature = await account.signMessage({ message: 'x' });

    await expect(verifyEvmSignature({ address: 'not-an-address', message: 'x', signature })).resolves.toBe(false);
  });

  it('returns false, never throws, for an empty signature', async () => {
    await expect(verifyEvmSignature({ address: account.address, message: 'x', signature: '' })).resolves.toBe(false);
  });
});
