import { BadRequestException, Injectable } from '@nestjs/common';
import { prisma } from '@fomo/db';
import {
  MAX_SAVED_SEARCHES_PER_USER,
  SavedSearchDisplayNameSchema,
  SavedSearchQuerySchema,
  type CreateSavedSearchInput,
  type SavedSearchDto,
} from '@fomo/domain';

/**
 * Owns saved searches — a lightweight bookmark of a query string, nothing more (no stored
 * result set, no scheduled re-run, no analytics). See docs/PHASE6_RETENTION_SOCIAL.md#saved-searches.
 * `userId` is always the caller's own session id (see SavedSearchController) — the same
 * ownership-scoping-in-the-WHERE-clause IDOR defense every other per-user mutation here uses.
 */
@Injectable()
export class SavedSearchService {
  /** Enforced here, not as a DB constraint — see MAX_SAVED_SEARCHES_PER_USER in @fomo/domain.
   *  Query/display name are re-validated (and trimmed) against the domain schema here rather
   *  than trusting the DTO layer alone, the same defense-in-depth every other service in
   *  this codebase applies at its own boundary. */
  async create(userId: string, input: CreateSavedSearchInput): Promise<SavedSearchDto> {
    const parsedQuery = SavedSearchQuerySchema.safeParse(input.query);
    if (!parsedQuery.success) throw new BadRequestException('query must be a non-empty, non-whitespace string');
    const query = parsedQuery.data;

    let displayName: string | null = null;
    if (input.displayName != null) {
      const parsedName = SavedSearchDisplayNameSchema.safeParse(input.displayName);
      if (!parsedName.success) throw new BadRequestException('displayName must be a non-empty, non-whitespace string');
      displayName = parsedName.data;
    }

    const count = await prisma.savedSearch.count({ where: { userId } });
    if (count >= MAX_SAVED_SEARCHES_PER_USER) {
      throw new BadRequestException(`You can save at most ${MAX_SAVED_SEARCHES_PER_USER} searches — delete one first`);
    }

    const row = await prisma.savedSearch.create({ data: { userId, query, displayName } });
    return toDto(row);
  }

  async list(userId: string): Promise<SavedSearchDto[]> {
    // Bounded by construction: create() never lets a user exceed MAX_SAVED_SEARCHES_PER_USER,
    // so this is always a small, cheap query — no pagination needed at this scale.
    const rows = await prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toDto);
  }

  /** Idempotent by construction, scoped to `userId` in the WHERE clause — this is the IDOR
   *  defense: another user's search id simply matches zero rows, never a 403 that would
   *  confirm the id exists. Deleting zero matching rows is not an error. */
  async delete(userId: string, id: string): Promise<void> {
    await prisma.savedSearch.deleteMany({ where: { id, userId } });
  }
}

function toDto(row: { id: string; query: string; displayName: string | null; createdAt: Date; updatedAt: Date }): SavedSearchDto {
  return {
    id: row.id,
    query: row.query,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
