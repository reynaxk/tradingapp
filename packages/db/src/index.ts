import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single shared PrismaClient instance.
 *
 * Kept on `globalThis` in non-production so hot-reloading apps.web / apps.api during
 * development doesn't open a fresh connection pool on every reload and exhaust Postgres'
 * connection limit — the standard pattern for Prisma in a dev server.
 */
declare global {
  // eslint-disable-next-line no-var
  var __fomoPrisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalThis.__fomoPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__fomoPrisma__ = prisma;
}
