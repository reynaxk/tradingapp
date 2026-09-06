import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { normalizeEvmAddress, type TraderProfile } from '@fomo/domain';
import { toTraderProfile, toTraderStats, toTraderSummary } from '../social.mapper';
import { FollowService } from './follow.service';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Trader identity: profiles, stats computed from indexed swaps, and follower/following
 * lists. See docs/SOCIAL.md#trader-identity. Never computes profit/ROI/win rate — Fomo
 * doesn't track cost basis, so Phase 2 only surfaces what can be computed correctly.
 */
@Injectable()
export class TraderService {
  constructor(private readonly follows: FollowService) {}

  async getProfile(address: string, viewerUserId: string | null): Promise<TraderProfile> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const [agg, buyCount, sellCount, lastSwap, followerCount, followingCount, isFollowedByMe] = await Promise.all([
      prisma.swap.aggregate({ where: { traderAddress: normalized }, _count: { _all: true }, _sum: { volumeUsd: true } }),
      prisma.swap.count({ where: { traderAddress: normalized, side: 'buy' } }),
      prisma.swap.count({ where: { traderAddress: normalized, side: 'sell' } }),
      prisma.swap.findFirst({
        where: { traderAddress: normalized },
        orderBy: { blockTimestamp: 'desc' },
        select: { blockTimestamp: true },
      }),
      prisma.follow.count({ where: { walletAddress: normalized } }),
      // Only ever non-zero once a User has linked this exact wallet and made follows of
      // their own — see the User.walletAddress comment in schema.prisma.
      prisma.follow.count({ where: { user: { walletAddress: normalized } } }),
      this.follows.isFollowing(viewerUserId, normalized),
    ]);

    const stats = toTraderStats(
      wallet,
      { totalSwaps: agg._count._all, buyCount, sellCount, volumeUsd: agg._sum.volumeUsd },
      lastSwap?.blockTimestamp ?? null,
    );

    return toTraderProfile(wallet, stats, followerCount, followingCount, isFollowedByMe);
  }

  /** Users following this trader. Items are deliberately minimal (`userId` + when) — Phase
   *  2's anonymous sessions have no public display identity to show yet; see
   *  docs/SOCIAL.md#authentication for why, and the follow-count on the profile for the
   *  number most UI needs. */
  async getFollowers(address: string, rawCursor: string | undefined, limit: number): Promise<CursorPage<{ userId: string; followedAt: string }>> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, select: { address: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const cursor = rawCursor ? decodeFollowCursor(rawCursor) : null;
    const rows = await prisma.follow.findMany({
      where: {
        walletAddress: normalized,
        ...(cursor ? { createdAt: { lt: new Date(cursor.createdAt) }, } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeFollowCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map((f) => ({ userId: f.userId, followedAt: f.createdAt.toISOString() })), nextCursor };
  }

  /** Wallets this trader's linked User account follows. Almost always empty in Phase 2
   *  (wallet-linking isn't implemented yet — see docs/WALLET_SECURITY.md) but implemented
   *  for real so it needs no contract change once linking ships. */
  async getFollowing(
    address: string,
    rawCursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<{ address: string; displayName: string | null; avatarUrl: string | null }>> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, select: { address: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const cursor = rawCursor ? decodeFollowCursor(rawCursor) : null;
    const rows = await prisma.follow.findMany({
      where: {
        user: { walletAddress: normalized },
        ...(cursor ? { createdAt: { lt: new Date(cursor.createdAt) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { wallet: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeFollowCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map((f) => toTraderSummary(f.wallet)), nextCursor };
  }

  /** Address-prefix or display-name search — server-backed, indexed, bounded. See
   *  docs/SOCIAL.md#search. */
  async search(query: string, limit: number): Promise<{ address: string; displayName: string | null; avatarUrl: string | null }[]> {
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { address: { contains: query.toLowerCase() } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { firstSeenAt: 'desc' },
    });
    return wallets.map(toTraderSummary);
  }
}

interface FollowCursor {
  createdAt: string;
  id: string;
}

function encodeFollowCursor(cursor: FollowCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeFollowCursor(raw: string): FollowCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FollowCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
