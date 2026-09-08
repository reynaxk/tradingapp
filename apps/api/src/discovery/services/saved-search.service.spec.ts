import { BadRequestException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { MAX_SAVED_SEARCHES_PER_USER } from '@fomo/domain';
import { SavedSearchService } from './saved-search.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    savedSearch: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

describe('SavedSearchService', () => {
  let service: SavedSearchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SavedSearchService();
  });

  describe('create', () => {
    it('rejects a whitespace-only query even though it would pass a naive non-empty check', async () => {
      (mockedPrisma.savedSearch.count as jest.Mock).mockResolvedValue(0);
      await expect(service.create(USER_ID, { query: '   ' })).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.savedSearch.create).not.toHaveBeenCalled();
    });

    it('trims the query and display name before persisting', async () => {
      (mockedPrisma.savedSearch.count as jest.Mock).mockResolvedValue(0);
      (mockedPrisma.savedSearch.create as jest.Mock).mockResolvedValue({
        id: 'search-1',
        query: 'pepe',
        displayName: 'My search',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create(USER_ID, { query: '  pepe  ', displayName: '  My search  ' });

      expect(mockedPrisma.savedSearch.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, query: 'pepe', displayName: 'My search' },
      });
    });

    it('rejects creation once the caller is at the documented per-user cap', async () => {
      (mockedPrisma.savedSearch.count as jest.Mock).mockResolvedValue(MAX_SAVED_SEARCHES_PER_USER);
      await expect(service.create(USER_ID, { query: 'pepe' })).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.savedSearch.create).not.toHaveBeenCalled();
    });

    it('scopes the cap check to the caller\'s own searches only', async () => {
      (mockedPrisma.savedSearch.count as jest.Mock).mockResolvedValue(0);
      (mockedPrisma.savedSearch.create as jest.Mock).mockResolvedValue({
        id: 'search-1',
        query: 'pepe',
        displayName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create(USER_ID, { query: 'pepe' });

      expect(mockedPrisma.savedSearch.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    });
  });

  describe('list', () => {
    it('is scoped to the given userId only', async () => {
      (mockedPrisma.savedSearch.findMany as jest.Mock).mockResolvedValue([]);
      await service.list(USER_ID);
      expect(mockedPrisma.savedSearch.findMany).toHaveBeenCalledWith({ where: { userId: USER_ID }, orderBy: { createdAt: 'desc' } });
    });
  });

  describe('delete', () => {
    it('scopes the delete to both the id and the caller\'s own userId — the IDOR defense', async () => {
      (mockedPrisma.savedSearch.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      await service.delete(OTHER_USER_ID, 'search-owned-by-someone-else');
      expect(mockedPrisma.savedSearch.deleteMany).toHaveBeenCalledWith({
        where: { id: 'search-owned-by-someone-else', userId: OTHER_USER_ID },
      });
    });

    it('is idempotent — deleting zero matching rows is a success, not an error', async () => {
      (mockedPrisma.savedSearch.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(service.delete(USER_ID, 'nonexistent')).resolves.toBeUndefined();
    });
  });
});
