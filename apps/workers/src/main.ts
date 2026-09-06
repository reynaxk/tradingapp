import { parseEnv } from '@fomo/domain';
import { EvmChainDataProvider } from '@fomo/chain-adapters';
import { prisma } from '@fomo/db';
import { Redis } from 'ioredis';
import { EnvSchema } from './config/env';
import { createLogger } from './lib/logger';
import { MarketIngestionService } from './market/ingestion';

/**
 * Phase 0 proved DB, Redis, and the chain adapter all connect, and that the process
 * starts and stops cleanly. Phase 1 adds the real payload: seed the tracked markets, then
 * tick price/liquidity refresh and incremental swap ingestion on a timer. See
 * /docs/SOURCE_OF_TRUTH.md and /docs/MARKET_DATA.md.
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

  const heartbeat = setInterval(() => {
    logger.info({ uptimeSeconds: Math.round(process.uptime()) }, 'Worker heartbeat');
  }, env.HEARTBEAT_INTERVAL_SECONDS * 1000);
  heartbeat.unref();

  let marketTicker: NodeJS.Timeout | undefined;
  if (dbReady && chainReady) {
    const ingestion = new MarketIngestionService(
      {
        chainIdentifier: env.CHAIN_IDENTIFIER,
        chainName: env.CHAIN_NAME,
        chainNativeSymbol: env.CHAIN_NATIVE_SYMBOL,
        rpcConfigKey: 'CHAIN_RPC_URL',
      },
      env.CHAIN_RPC_URL,
      logger,
    );

    await ingestion.seed().catch((error: Error) => {
      logger.error({ err: error }, 'Market seeding failed — will retry on the next tick boundary');
    });

    let tickRunning = false;
    const runTick = async (): Promise<void> => {
      if (tickRunning) {
        logger.warn('Skipped market ingestion tick: previous tick still running');
        return;
      }
      tickRunning = true;
      const startedAt = Date.now();
      try {
        await ingestion.refreshPricesAndLiquidity();
        await ingestion.ingestSwaps();
        logger.info({ durationMs: Date.now() - startedAt }, 'Market ingestion tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Market ingestion tick failed — will retry next tick');
      } finally {
        tickRunning = false;
      }
    };

    await runTick();
    marketTicker = setInterval(() => void runTick(), env.MARKET_INGESTION_INTERVAL_SECONDS * 1000);
    marketTicker.unref();
  } else {
    logger.warn({ dbReady, chainReady }, 'Market ingestion disabled this run: a required dependency is down');
  }

  logger.info('Worker ready');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    clearInterval(heartbeat);
    if (marketTicker) clearInterval(marketTicker);
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
