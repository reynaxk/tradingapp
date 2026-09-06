import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import type { Prisma } from '@fomo/db';
import { DISCOVERY_RANKING, decodeActivityCursor, encodeActivityCursor, normalizeEvmAddress, type SocialActivity } from '@fomo/domain';
import { toSocialActivity, type ActivityRow } from '../social.mapper';

export interface ActivityPage {
  items: SocialActivity[];
  nextCursor: string | null;
}

const ACTIVITY_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true, chain: true } },
  trader: true,
} as const;

/**
 * Every paginated, swap-backed activity listing — the global feed, the following feed, one
 * trader's activity, and one token's activity all share this machinery rather than four
 * bespoke queries. See docs/SOCIAL.md#activity-model and #pagination.
 */
@Injectable()
export class ActivityService {
  /** Recent activity across every tracked market above the liquidity floor — see
   *  docs/SOCIAL.md#trending for why the same floor as Phase 1's discovery gate applies
   *  here too (a global feed with no quality bar is just noise). Optionally scoped to one
   *  token, in which case the floor is skipped: a token's own page shows its own activity
   *  regardless of how it ranks. */
  async getGlobalFeed(params: {
    cursor?: string;
    limit: number;
    tokenAddress?: string;
    viewerUserId: string | null;
  }): Promise<ActivityPage> {
    const where: Prisma.SwapWhereInput = params.tokenAddress
      ? { tokenMarket: { token: { contractAddress: { equals: normalizeEvmAddress(params.tokenAddress), mode: 'insensitive' } } } }
      : { tokenMarket: { liquidityUsd: { gte: DISCOVERY_RANKING.minLiquidityUsd } } };

    return this.fetchPage(where, params.cursor, params.limit, params.viewerUserId);
  }

  /** Activity from wallets the given user follows — empty (not an error) if they follow no
   *  one, per docs/SOCIAL.md's empty-state rules. */
  async getFollowingFeed(params: { userId: string; cursor?: string; limit: number }): Promise<ActivityPage> {
    const follows = await prisma.follow.findMany({ where: { userId: params.userId }, select: { walletAddress: true } });
    if (follows.length === 0) return { items: [], nextCursor: null };

    const where: Prisma.SwapWhereInput = { traderAddress: { in: follows.map((f) => f.walletAddress) } };
    return this.fetchPage(where, params.cursor, params.limit, params.userId);
  }

  /** One trader's own activity — the trader profile page's activity tab. 404s (rather than
   *  an empty page) for an address our indexer has never observed trading, matching
   *  getProfile's contract. */
  async getTraderActivity(params: {
    address: string;
    cursor?: string;
    limit: number;
    viewerUserId: string | null;
  }): Promise<ActivityPage> {
    const normalized = normalizeEvmAddress(params.address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${params.address}"`);

    return this.fetchPage({ traderAddress: normalized }, params.cursor, params.limit, params.viewerUserId);
  }

  private async fetchPage(
    where: Prisma.SwapWhereInput,
    rawCursor: string | undefined,
    limit: number,
    viewerUserId: string | null,
  ): Promise<ActivityPage> {
    const cursor = rawCursor ? decodeActivityCursor(rawCursor) : null;
    // An invalid cursor is treated as "no cursor" (start from the newest), never a 400 —
    // it's untrusted client input, see docs/SOCIAL.md#security.
    const cursorWhere: Prisma.SwapWhereInput = cursor
      ? {
          OR: [
            { blockTimestamp: { lt: new Date(cursor.blockTimestamp) } },
            { blockTimestamp: new Date(cursor.blockTimestamp), id: { lt: cursor.id } },
          ],
        }
      : {};

    const rows = await prisma.swap.findMany({
      where: { AND: [where, cursorWhere] },
      orderBy: [{ blockTimestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: ACTIVITY_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page: ActivityRow[] = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeActivityCursor({ blockTimestamp: last.blockTimestamp.toISOString(), id: last.id }) : null;

    const [likeCounts, likedByMe] = await this.batchLikeState(
      page.map((s) => s.id),
      viewerUserId,
    );

    return {
      items: page.map((row) => toSocialActivity(row, likeCounts.get(row.id) ?? 0, likedByMe ? likedByMe.has(row.id) : null)),
      nextCursor,
    };
  }

  /** One groupBy for counts + one findMany for "did I like it" — bounded to this page's
   *  swap ids, never per-item, however many activity rows the page contains. */
  private async batchLikeState(
    swapIds: string[],
    viewerUserId: string | null,
  ): Promise<[Map<string, number>, Set<string> | null]> {
    if (swapIds.length === 0) return [new Map(), viewerUserId ? new Set() : null];

    const counts = await prisma.activityLike.groupBy({
      by: ['swapId'],
      where: { swapId: { in: swapIds } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.swapId, c._count._all]));

    if (!viewerUserId) return [countMap, null];

    const mine = await prisma.activityLike.findMany({
      where: { userId: viewerUserId, swapId: { in: swapIds } },
      select: { swapId: true },
    });
    return [countMap, new Set(mine.map((m) => m.swapId))];
  }
}
