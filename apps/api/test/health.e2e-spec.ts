import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Requires a reachable Postgres (DATABASE_URL) and Redis (REDIS_URL) — run
 * `docker compose up -d` locally first, or rely on CI's service containers.
 * See /docs/TESTING.md.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the database and redis as reachable', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.info).toHaveProperty('database');
    expect(response.body.info).toHaveProperty('redis');
  });

  it('is not prefixed with /v1, unlike every future domain route', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health');
    expect(response.status).toBe(404);
  });
});
