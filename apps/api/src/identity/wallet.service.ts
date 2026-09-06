import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyEvmSignature } from '@fomo/chain-adapters';
import { prisma } from '@fomo/db';
import {
  buildSiweMessage,
  isEvmAddress,
  normalizeEvmAddress,
  WALLET_CHALLENGE_TTL_MINUTES,
  type LinkedWallet,
  type WalletChallenge,
} from '@fomo/domain';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';

/**
 * Wallet ownership verification — see docs/TRADING.md#wallet-ownership. A client-supplied
 * address is never trusted as proof of anything on its own; only a signature this service
 * itself verifies, over a message it itself generated and a nonce it itself issued, links
 * a wallet to an account.
 */
@Injectable()
export class WalletService {
  private readonly domain: string;
  private readonly chainId: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    // The first configured CORS origin is the web app's own public URL — reused here
    // rather than adding a second, redundant "what's our public URL" env var.
    this.domain = config.get('CORS_ORIGIN', { infer: true }).split(',')[0]!.trim();
    this.chainId = config.get('CHAIN_ID', { infer: true });
    this.logger.setContext('WalletService');
  }

  /** Issues a fresh, single-use challenge for `address`, tied to `userId` — only the
   *  session that requested a challenge can ever consume it (see `verifyChallenge`). */
  async createChallenge(userId: string, address: string): Promise<WalletChallenge> {
    if (!isEvmAddress(address)) throw new BadRequestException('address must be a valid EVM address');
    const normalized = normalizeEvmAddress(address);

    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + WALLET_CHALLENGE_TTL_MINUTES * 60_000);
    const message = buildSiweMessage({
      domain: this.domain,
      address: normalized,
      statement: 'Sign in to Fomo to verify wallet ownership. This request will not trigger a blockchain transaction or cost any gas.',
      uri: this.domain,
      chainId: this.chainId,
      nonce,
      issuedAt,
      expirationTime: expiresAt,
    });

    await prisma.walletChallenge.create({ data: { address: normalized, nonce, message, userId, expiresAt } });
    this.logger.info({ address: normalized }, 'wallet challenge issued');

    return { nonce, message, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Verifies a signature over a previously-issued challenge and, on success, links the
   * wallet to `userId`. Re-verifying a wallet already linked to a *different* account
   * moves the link — proving control of the private key is the only thing that matters,
   * not which session asked first. See docs/TRADING.md#wallet-ownership.
   */
  async verifyChallenge(userId: string, nonce: string, signature: string): Promise<LinkedWallet> {
    const challenge = await prisma.walletChallenge.findUnique({ where: { nonce } });
    if (!challenge || challenge.userId !== userId) {
      throw new BadRequestException('Unknown challenge');
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This challenge has expired — request a new one');
    }

    const isValidSignature = await verifyEvmSignature({
      address: challenge.address,
      message: challenge.message,
      signature,
    });
    if (!isValidSignature) {
      this.logger.warn({ address: challenge.address }, 'wallet verification failed: signature did not match');
      throw new UnauthorizedException('Signature verification failed');
    }

    // Atomic single-use consumption: only proceeds if THIS call is the one flipping
    // usedAt from null. Guards a concurrent double-verify race on the same nonce — see
    // docs/TRADING.md#wallet-ownership.
    const consumed = await prisma.walletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('This challenge has already been used');
    }

    const now = new Date();
    const wallet = await prisma.wallet.upsert({
      where: { address: challenge.address },
      update: { userId, verifiedAt: now, lastUsedAt: now },
      create: { address: challenge.address, userId, verifiedAt: now, lastUsedAt: now, firstSeenAt: now },
    });
    this.logger.info({ address: wallet.address }, 'wallet verified and linked');

    return { address: wallet.address, verifiedAt: wallet.verifiedAt!.toISOString(), lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null };
  }

  async listWallets(userId: string): Promise<LinkedWallet[]> {
    const wallets = await prisma.wallet.findMany({ where: { userId }, orderBy: { verifiedAt: 'desc' } });
    return wallets.map((w) => ({
      address: w.address,
      verifiedAt: w.verifiedAt!.toISOString(),
      lastUsedAt: w.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /** Detaches a wallet from the account rather than deleting the `Wallet` row — it may
   *  still hold real public trading history (Swaps, Follows) that must keep existing. */
  async unlinkWallet(userId: string, address: string): Promise<void> {
    if (!isEvmAddress(address)) throw new BadRequestException('address must be a valid EVM address');
    const normalized = normalizeEvmAddress(address);

    const result = await prisma.wallet.updateMany({
      where: { address: normalized, userId },
      data: { userId: null, verifiedAt: null },
    });
    if (result.count === 0) {
      throw new NotFoundException('No verified wallet at that address is linked to your account');
    }
    this.logger.info({ address: normalized }, 'wallet unlinked');
  }
}
