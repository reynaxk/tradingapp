import { parseEnv } from '@fomo/domain';
import { EvmChainDataProvider } from '@fomo/chain-adapters';
import { prisma } from '@fomo/db';
import { Redis } from 'ioredis';
import { EnvSchema } from './config/env';
import { createLogger } from './lib/logger';

/**
 * Phase 0: prove every piece the future indexer needs — DB, Redis, and a chain adapter —
 * actually connects, and that the process starts and stops cleanly. No queues, no polling,
 * no persistence of chain data yet; that's Phase 1. See /docs/SOURCE_OF_TRUTH.md.
 */
async function main(): Promise<void> {
  const env = parseEnv(EnvSchema, process.env);
  const logger = createLogger(env);

  logger.info('Worker starting');

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  // Without a listener, ioredis dumps reconnect errors straight to stderr, bypassing
  // structured logging entirely — route them through the same logger everything else uses.
  redis.on('error', (error) => logger.error({ err: error }, 'Redis client error'));

  const redisReady = await redis
    .ping()
    .then((reply) => reply === 'PONG')
    .catch((error: Error) => {
      logger.error({ err: error }, 'Redis connectivity check failed');
      return false;
    });
  logger.info({ redisReady }, 'Redis connectivity check');

  const dbReady = await prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch((error: Error) => {
      logger.error({ err: error }, 'Database connectivity check failed');
      return false;
    });
  logger.info({ dbReady }, 'Database connectivity check');

  const chainAdapter = new EvmChainDataProvider({
    chain: {
      identifier: env.CHAIN_IDENTIFIER,
      name: env.CHAIN_NAME,
      nativeSymbol: env.CHAIN_NATIVE_SYMBOL,
    },
    rpcUrl: env.CHAIN_RPC_URL,
  });
  const chainReady = await chainAdapter.isHealthy();
  logger.info({ chain: chainAdapter.chain.identifier, chainReady }, 'Chain adapter connectivity check');

  logger.info('Worker foundation ready — no jobs registered yet (Phase 1+)');

  const heartbeat = setInterval(() => {
    logger.info({ uptimeSeconds: Math.round(process.uptime()) }, 'Worker heartbeat');
  }, env.HEARTBEAT_INTERVAL_SECONDS * 1000);
  heartbeat.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    clearInterval(heartbeat);
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Worker failed to start', error);
  process.exit(1);
});
