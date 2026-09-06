import type { INestApplication} from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';

/**
 * Nest's TestingModule does not replay main.ts's bootstrap — a test that only calls
 * `moduleRef.createNestApplication()` gets an app with no global prefix and no validation
 * pipe, silently testing a different URL shape than production actually serves (this
 * exact gap made every /v1/market/* assertion in market.e2e-spec.ts 404 on its first CI
 * run — see docs/TESTING.md). Every e2e spec should build its app through this helper
 * instead of duplicating main.ts's setup inline, so the two can't drift apart again.
 */
export async function createTestApp(moduleRef: TestingModule): Promise<INestApplication> {
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  await app.init();
  return app;
}
