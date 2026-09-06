import { verifyMessage } from 'viem';

/**
 * Verifies that `signature` over `message` was produced by the private key controlling
 * `address` — the entire cryptographic core of wallet ownership verification (see
 * docs/TRADING.md#wallet-ownership). Pure EOA (personal_sign) verification: no RPC client
 * is passed, so a smart-contract wallet (ERC-1271 — Safe, some smart accounts) cannot be
 * verified this way and this returns `false` for one, never a false positive. Documented
 * limitation, not a silent gap — see docs/TRADING.md#known-limitations.
 *
 * Never throws on a malformed signature/address — a caller asking "did this address sign
 * this message" should get `false` for garbage input, not an exception to handle
 * separately from a genuine mismatch.
 */
export async function verifyEvmSignature(params: { address: string; message: string; signature: string }): Promise<boolean> {
  try {
    return await verifyMessage({
      address: params.address as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
