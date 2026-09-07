import { z } from 'zod';

/**
 * Builds and parses the EIP-4361 ("Sign-In with Ethereum") message a wallet signs to prove
 * ownership of an address — see docs/TRADING.md#wallet-ownership. Pure formatting only; the
 * nonce itself must come from a cryptographically random source (`crypto.randomBytes` in
 * apps/api/src/identity/wallet.service.ts) — nothing in this module generates one, so it
 * can't accidentally be used with a predictable value.
 */

/** How long a wallet-ownership challenge stays valid before it must be re-requested — long
 *  enough to approve in a wallet extension, short enough that a stale, unsigned challenge
 *  is never usable — see docs/TRADING.md#wallet-ownership. */
export const WALLET_CHALLENGE_TTL_MINUTES = 5;

export interface SiweMessageParams {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
}

/** EIP-4361's exact field order and labels — a wallet's signing UI renders this message
 *  verbatim, so both the byte-for-byte format and the field order matter. */
export function buildSiweMessage(params: SiweMessageParams): string {
  const { domain, address, statement, uri, chainId, nonce, issuedAt, expirationTime } = params;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement,
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expirationTime.toISOString()}`,
  ].join('\n');
}

export const WalletChallengeSchema = z.object({
  nonce: z.string().min(1),
  message: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type WalletChallenge = z.infer<typeof WalletChallengeSchema>;

export const LinkedWalletSchema = z.object({
  address: z.string(),
  verifiedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type LinkedWallet = z.infer<typeof LinkedWalletSchema>;
