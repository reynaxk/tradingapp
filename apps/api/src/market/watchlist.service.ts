import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fomo/db';
import {
  decodeWatchlistCursor,
  encodeWatchlistCursor,
  isEvmAddress,
  type WatchedToken,
  type WatchlistPage,
} from '@fomo/domain';
import { toMarketSummary } from './market.mapper';

const MARKET_INCLUDE = { token: true, quoteToken: true, chain: true } as const;

/**
 * Owns the `TokenWatch` table — a user "watching" a token market. Same idempotent-mutation
 * pattern FollowService already uses: uniqueness enforced at the DB level
 * (`@@unique([userId, tokenMarketId])`), so a duplicate watch/unwatch is a no-op success,
 * never an error a retried or double-clicked request would surface. See
 * docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 */
@Injectable()
export class WatchlistService {
  private async resolveTokenMarketId(address: string): Promise<string> {
    if (!isEvmAddress(address))
      throw new BadRequestException(`"${address}" is not a valid contract address`);
    const market = await prisma.tokenMarket.findFirst({
      where: { token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      orderBy: { liquidityUsd: 'desc' },
      select: { id: true },
    });
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);
    return market.id;
  }

  async watch(userId: string, address: string): Promise<void> {
    const tokenMarketId = await this.resolveTokenMarketId(address);
    try {
      await prisma.tokenWatch.create({ data: { userId, tokenMarketId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return; // already watching — idempotent success, not an error
      }
      throw error;
    }
  }

  /** Idempotent by construction: deleting zero matching rows is not an error. Resolves the
   *  address to a market first (same 404 as `watch` on an unknown/typo'd address) rather
   *  than silently no-op'ing on garbage input. */
  async unwatch(userId: string, address: string): Promise<void> {
    const tokenMarketId = await this.resolveTokenMarketId(address);
    await prisma.tokenWatch.deleteMany({ where: { userId, tokenMarketId } });
  }

  /** `null` when there is no viewer to check against (unauthenticated) — same contract as
   *  FollowService#isFollowing/TraderProfile.isFollowedByMe: never a fabricated `false`. */
  async isWatching(userId: string | null, address: string): Promise<boolean | null> {
    if (!userId) return null;
    const tokenMarketId = await this.resolveTokenMarketId(address);
    const existing = await prisma.tokenWatch.findUnique({
      where: { userId_tokenMarketId: { userId, tokenMarketId } },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * Cursor-paginated, newest-watched-first — see WatchlistCursor in @fomo/domain, same
   * keyset-pagination shape as ActivityService's own feed. Bounded `take`, one join query,
   * never an unbounded `findMany` over a user's whole watchlist.
   */
  async listForUser(
    userId: string,
    rawCursor: string | undefined,
    limit: number,
  ): Promise<WatchlistPage> {
    const cursor = rawCursor ? decodeWatchlistCursor(rawCursor) : null;
    // An invalid cursor is treated as "no cursor" — untrusted client input, never a 400.
    const cursorWhere: Prisma.TokenWatchWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }
      : {};

    const rows = await prisma.tokenWatch.findMany({
      where: { AND: [{ userId }, cursorWhere] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { tokenMarket: { include: MARKET_INCLUDE } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeWatchlistCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;

    const items: WatchedToken[] = page.map((row) => ({
      ...toMarketSummary(row.tokenMarket),
      watchedAt: row.createdAt.toISOString(),
    }));

    return { items, nextCursor };
  }

  /** Bounded aggregate — one COUNT per token-detail view, never per watcher. Public
   *  (aggregate-only): callers must never expose which specific users are in this count. */
  async getWatcherCount(tokenMarketId: string): Promise<number> {
    return prisma.tokenWatch.count({ where: { tokenMarketId } });
  }

  /** Which of the given candidate token markets `userId` is watching — one bounded `IN`
   *  query regardless of candidate count, never a query per candidate. Feeds
   *  DiscoveryService's `isWatched` personalization signal. */
  async getWatchedSet(userId: string, tokenMarketIds: string[]): Promise<Set<string>> {
    if (tokenMarketIds.length === 0) return new Set();
    const rows = await prisma.tokenWatch.findMany({
      where: { userId, tokenMarketId: { in: tokenMarketIds } },
      select: { tokenMarketId: true },
    });
    return new Set(rows.map((r) => r.tokenMarketId));
  }
}
