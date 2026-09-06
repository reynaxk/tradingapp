import { parseEnv } from '@fomo/domain';
import { EvmChainDataProvider } from '@fomo/chain-adapters';
import { prisma } from '@fomo/db';
import { Redis } from 'ioredis';
import { EnvSchema } from './config/env';
import { createLogger } from './lib/logger';
import { MarketIngestionService } from './market/ingestion';
import { TradeSweepService } from './trading/sweep';

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
      redis,
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

  // The real numeric EVM chain id (e.g. 8453) that TradeTransaction.chainId is stored
  // as — distinct from Chain.id (an internal DB row id) and not itself a separate env var,
  // since CHAIN_IDENTIFIER (a CAIP-2 string, "eip155:8453") already names it authoritatively.
  const tradeChainId = Number(env.CHAIN_IDENTIFIER.split(':')[1]);

  let tradeSweepTicker: NodeJS.Timeout | undefined;
  if (dbReady && chainReady && Number.isInteger(tradeChainId)) {
    const sweep = new TradeSweepService(tradeChainId, chainAdapter, logger);

    let sweepRunning = false;
    const runSweep = async (): Promise<void> => {
      if (sweepRunning) {
        logger.warn('Skipped trade sweep tick: previous tick still running');
        return;
      }
      sweepRunning = true;
      const startedAt = Date.now();
      try {
        const result = await sweep.sweepPendingTransactions();
        logger.info({ ...result, durationMs: Date.now() - startedAt }, 'Trade sweep tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Trade sweep tick failed — will retry next tick');
      } finally {
        sweepRunning = false;
      }
    };

    await runSweep();
    tradeSweepTicker = setInterval(() => void runSweep(), env.TRADE_SWEEP_INTERVAL_SECONDS * 1000);
    tradeSweepTicker.unref();
  } else {
    logger.warn({ dbReady, chainReady, tradeChainId }, 'Trade sweep disabled this run: a required dependency is down or CHAIN_IDENTIFIER is not a parseable eip155 chain id');
  }

  logger.info('Worker ready');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    clearInterval(heartbeat);
    if (marketTicker) clearInterval(marketTicker);
    if (tradeSweepTicker) clearInterval(tradeSweepTicker);
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
