import { EvmChainDataProvider, UniswapV3PoolReader } from '@fomo/chain-adapters';
import {
  computeFullyDilutedMarketCapUsd,
  computePoolLiquidityUsd,
  priceFromSqrtPriceX96,
  rawAmountToDecimal,
} from '@fomo/chain-adapters';
import type { Prisma } from '@fomo/db';
import { prisma } from '@fomo/db';
import type { Logger } from 'pino';
import { BASE_SEED_MARKETS, USDC_ADDRESS_BASE, type SeedMarket } from './seed-markets';

/** Raw candle granularity — see the Candle model comment in schema.prisma. */
const BUCKET_MINUTES = 5;
/** How far back the very first tick backfills real swap history for a newly-seeded market. */
const INITIAL_BACKFILL_BLOCKS = 43_200n; // ~24h on Base at ~2s/block
/** Upper bound on how far one tick advances a market's cursor — keeps a single tick
 *  bounded and RPC-friendly; a large backfill simply continues over several ticks. */
const MAX_BLOCKS_PER_TICK = 20_000n;
/** eth_getLogs range per request — the public Base RPC starts failing above ~10-50k. */
const LOG_CHUNK_BLOCKS = 5_000n;
/** Space out RPC calls so the free public endpoint doesn't rate-limit us mid-tick. */
const RPC_CALL_DELAY_MS = 350;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MarketIngestionConfig {
  chainIdentifier: string;
  chainName: string;
  chainNativeSymbol: string;
  rpcConfigKey: string;
}

/**
 * Owns the full Phase 1 pipeline for one chain: seed → price/liquidity snapshot →
 * incremental swap backfill → candle/rollup recomputation. Every write is idempotent
 * (upserts keyed exactly as documented in docs/SOURCE_OF_TRUTH.md), so a crash mid-tick
 * just means the next tick redoes a little work, never corrupts state.
 */
export class MarketIngestionService {
  private readonly poolReader: UniswapV3PoolReader;
  private readonly tokenReader: EvmChainDataProvider;
  private chainId: number | null = null;

  constructor(
    private readonly config: MarketIngestionConfig,
    rpcUrl: string,
    private readonly logger: Logger,
  ) {
    this.poolReader = new UniswapV3PoolReader({ rpcUrl });
    this.tokenReader = new EvmChainDataProvider({
      chain: { identifier: config.chainIdentifier, name: config.chainName, nativeSymbol: config.chainNativeSymbol },
      rpcUrl,
    });
  }

  /** Idempotent — upserts the chain, tokens, and markets. Safe to call every tick. */
  async seed(): Promise<void> {
    const chain = await prisma.chain.upsert({
      where: { identifier: this.config.chainIdentifier },
      update: {},
      create: {
        identifier: this.config.chainIdentifier,
        name: this.config.chainName,
        nativeSymbol: this.config.chainNativeSymbol,
        rpcConfigKey: this.config.rpcConfigKey,
      },
    });
    this.chainId = chain.id;

    let seeded = 0;
    for (const seedMarket of BASE_SEED_MARKETS) {
      const ok = await this.seedOneMarket(chain.id, seedMarket);
      if (ok) seeded += 1;
      await sleep(RPC_CALL_DELAY_MS);
    }
    this.logger.info({ attempted: BASE_SEED_MARKETS.length, seeded }, 'Market seeding complete');
  }

  private async seedOneMarket(chainId: number, seed: SeedMarket): Promise<boolean> {
    const poolState = await this.poolReader.getPoolState(seed.poolAddress);
    if (!poolState) {
      this.logger.warn({ pool: seed.poolAddress }, 'Skipped seeding: pool state unreadable');
      return false;
    }

    const quoteTokenAddress =
      poolState.token0.toLowerCase() === seed.baseTokenAddress.toLowerCase() ? poolState.token1 : poolState.token0;

    const baseToken = await this.upsertToken(chainId, seed.baseTokenAddress);
    await sleep(RPC_CALL_DELAY_MS);
    const quoteToken = await this.upsertToken(chainId, quoteTokenAddress);
    if (!baseToken || !quoteToken) {
      this.logger.warn({ pool: seed.poolAddress }, 'Skipped seeding: token metadata unreadable');
      return false;
    }

    const tokenMarket = await prisma.tokenMarket.upsert({
      where: { chainId_pairAddress: { chainId, pairAddress: seed.poolAddress } },
      update: { dex: seed.dex, feeTier: poolState.feeTier },
      create: {
        chainId,
        tokenId: baseToken.id,
        quoteTokenId: quoteToken.id,
        dex: seed.dex,
        pairAddress: seed.poolAddress,
        feeTier: poolState.feeTier,
      },
    });

    const latestBlock = await this.poolReader.getLatestBlockNumber();
    await prisma.ingestionCursor.upsert({
      where: { tokenMarketId: tokenMarket.id },
      update: {},
      create: {
        tokenMarketId: tokenMarket.id,
        lastProcessedBlock: bigintMax(0n, latestBlock - INITIAL_BACKFILL_BLOCKS),
      },
    });
    return true;
  }

  private async upsertToken(chainId: number, contractAddress: string) {
    const metadata = await this.tokenReader.getTokenMetadata(contractAddress);
    return prisma.token.upsert({
      where: { chainId_contractAddress: { chainId, contractAddress } },
      update: { symbol: metadata.symbol, name: metadata.name, decimals: metadata.decimals },
      create: {
        chainId,
        contractAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
      },
    });
  }

  /**
   * Refreshes current price/liquidity/market cap for every seeded market, in seed-list
   * order — a market quoted in another tracked token (e.g. DEGEN/WETH) resolves its quote
   * price from a market processed earlier in this same pass, never from a guess.
   */
  async refreshPricesAndLiquidity(): Promise<void> {
    const markets = await prisma.tokenMarket.findMany({
      where: { chainId: this.requireChainId() },
      include: { token: true, quoteToken: true },
    });
    const byPairAddress = new Map(markets.map((m) => [m.pairAddress.toLowerCase(), m]));
    const resolvedUsdPrices = new Map<string, number>([[USDC_ADDRESS_BASE.toLowerCase(), 1]]);

    let updated = 0;
    let skipped = 0;
    for (const seed of BASE_SEED_MARKETS) {
      const market = byPairAddress.get(seed.poolAddress.toLowerCase());
      if (!market) continue;

      const ok = await this.refreshOneMarket(market, resolvedUsdPrices);
      if (ok) updated += 1;
      else skipped += 1;
      await sleep(RPC_CALL_DELAY_MS);
    }
    this.logger.info({ updated, skipped }, 'Price/liquidity refresh complete');
  }

  private async refreshOneMarket(
    market: Prisma.TokenMarketGetPayload<{ include: { token: true; quoteToken: true } }>,
    resolvedUsdPrices: Map<string, number>,
  ): Promise<boolean> {
    if (market.token.decimals === null || market.quoteToken.decimals === null) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: decimals unknown');
      return false;
    }

    const poolState = await this.poolReader.getPoolState(market.pairAddress);
    if (!poolState) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: pool state unreadable');
      return false;
    }
    await sleep(RPC_CALL_DELAY_MS);

    const baseIsToken0 = poolState.token0.toLowerCase() === market.token.contractAddress.toLowerCase();
    const [dec0, dec1] = baseIsToken0
      ? [market.token.decimals, market.quoteToken.decimals]
      : [market.quoteToken.decimals, market.token.decimals];
    const priceQuotePerBase = priceFromSqrtPriceX96(poolState.sqrtPriceX96, dec0, dec1);
    if (priceQuotePerBase === null) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: pool uninitialized');
      return false;
    }
    // priceQuotePerBase is (token1 per token0); flip if base is token1.
    const quotePerBase = baseIsToken0 ? priceQuotePerBase : 1 / priceQuotePerBase;

    const quoteUsd = resolvedUsdPrices.get(market.quoteToken.contractAddress.toLowerCase());
    if (quoteUsd === undefined) {
      this.logger.warn(
        { pool: market.pairAddress, quote: market.quoteToken.symbol },
        'Skipped price refresh: quote token has no resolved USD price yet (seed list ordering)',
      );
      return false;
    }
    const baseUsd = quotePerBase * quoteUsd;
    resolvedUsdPrices.set(market.token.contractAddress.toLowerCase(), baseUsd);

    const [balance0, balance1] = await Promise.all([
      this.poolReader.getTokenBalance(poolState.token0, market.pairAddress),
      this.poolReader.getTokenBalance(poolState.token1, market.pairAddress),
    ]);
    await sleep(RPC_CALL_DELAY_MS);
    const price0Usd = baseIsToken0 ? baseUsd : quoteUsd;
    const price1Usd = baseIsToken0 ? quoteUsd : baseUsd;
    const liquidityUsd =
      balance0 !== null && balance1 !== null
        ? computePoolLiquidityUsd(balance0, dec0, price0Usd, balance1, dec1, price1Usd)
        : null;

    const totalSupply = await this.poolReader.getTotalSupply(market.token.contractAddress);
    const marketCapUsd =
      totalSupply !== null ? computeFullyDilutedMarketCapUsd(totalSupply, market.token.decimals, baseUsd) : null;

    await prisma.tokenMarket.update({
      where: { id: market.id },
      data: {
        priceUsd: baseUsd,
        liquidityUsd: liquidityUsd ?? undefined,
        marketCapUsd: marketCapUsd ?? undefined,
        lastPriceUpdateAt: new Date(),
      },
    });
    return true;
  }

  /** Incrementally scans new Swap events for every market, from its persisted cursor. */
  async ingestSwaps(): Promise<void> {
    const markets = await prisma.tokenMarket.findMany({
      where: { chainId: this.requireChainId() },
      include: { token: true, quoteToken: true, cursor: true },
    });

    // Current USD price per quote token, resolved once for this tick from whatever
    // refreshPricesAndLiquidity() last persisted (it runs first in the worker's tick —
    // see main.ts). Used to convert quote-denominated swap volume into USD — see the
    // "Swap volume in USD" note in docs/MARKET_DATA.md for the limitation this implies
    // for non-USD-quoted markets (their historical swaps are priced at today's quote rate,
    // not the rate at the time of that trade).
    const quoteUsdPrices = new Map<string, number>([[USDC_ADDRESS_BASE.toLowerCase(), 1]]);
    for (const m of markets) {
      if (m.priceUsd !== null) quoteUsdPrices.set(m.token.contractAddress.toLowerCase(), Number(m.priceUsd));
    }

    for (const market of markets) {
      if (!market.cursor) continue;
      const quoteUsd = quoteUsdPrices.get(market.quoteToken.contractAddress.toLowerCase());
      if (quoteUsd === undefined) {
        this.logger.warn({ pool: market.pairAddress }, 'Skipped swap ingestion: quote token has no resolved USD price');
        continue;
      }
      await this.ingestSwapsForMarket(market, quoteUsd);
      await sleep(RPC_CALL_DELAY_MS);
    }
  }

  private async ingestSwapsForMarket(
    market: Prisma.TokenMarketGetPayload<{ include: { token: true; quoteToken: true; cursor: true } }>,
    quoteUsdPrice: number,
  ): Promise<void> {
    if (market.token.decimals === null || market.quoteToken.decimals === null) return;
    const poolState = await this.poolReader.getPoolState(market.pairAddress);
    if (!poolState) return;
    const baseIsToken0 = poolState.token0.toLowerCase() === market.token.contractAddress.toLowerCase();
    const [poolDec0, poolDec1] = baseIsToken0
      ? [market.token.decimals, market.quoteToken.decimals]
      : [market.quoteToken.decimals, market.token.decimals];

    const latestBlock = await this.poolReader.getLatestBlockNumber();
    const cursorBlock = market.cursor!.lastProcessedBlock;

    if (latestBlock > cursorBlock) {
      const targetBlock = bigintMin(latestBlock, cursorBlock + MAX_BLOCKS_PER_TICK);
      const blockTimestampCache = new Map<string, Date>();
      let cursor = cursorBlock;
      let totalSwaps = 0;
      let minTs: Date | null = null;
      let maxTs: Date | null = null;

      while (cursor < targetBlock) {
        const chunkEnd = bigintMin(targetBlock, cursor + LOG_CHUNK_BLOCKS);
        const events = await this.poolReader.getSwapEvents(market.pairAddress, cursor + 1n, chunkEnd);
        if (events === null) {
          // eth_getLogs itself failed for this range — distinct from a successful query
          // that just found nothing. Stop here without touching the cursor, so the next
          // tick retries this exact range instead of silently skipping it forever.
          this.logger.warn(
            { pool: market.pairAddress, fromBlock: (cursor + 1n).toString(), toBlock: chunkEnd.toString() },
            'Stopped swap ingestion: eth_getLogs failed — cursor left unadvanced, will retry this range next tick',
          );
          break;
        }

        const rows: Prisma.SwapCreateManyInput[] = [];
        for (const event of events) {
          const key = event.blockNumber.toString();
          let blockTimestamp = blockTimestampCache.get(key);
          if (!blockTimestamp) {
            const ts = await this.poolReader.getBlockTimestamp(event.blockNumber);
            if (!ts) continue; // can't honestly place this swap in time — skip it, don't guess
            blockTimestamp = ts;
            blockTimestampCache.set(key, blockTimestamp);
            await sleep(RPC_CALL_DELAY_MS);
          }

          // priceFromSqrtPriceX96 always returns token1-per-token0; invert if base is token1
          // so `priceInQuote` ends up as this market's base-token price in terms of its
          // quote token, then convert to USD using this tick's resolved quote price.
          const rawPrice = priceFromSqrtPriceX96(event.sqrtPriceX96, poolDec0, poolDec1);
          const priceInQuote = rawPrice === null ? null : baseIsToken0 ? rawPrice : 1 / rawPrice;
          const baseAmountRaw = baseIsToken0 ? event.amount0 : event.amount1;
          const baseAmount = rawAmountToDecimal(baseAmountRaw, market.token.decimals);
          if (priceInQuote === null) continue;

          const priceUsd = priceInQuote * quoteUsdPrice;
          const volumeUsd = Math.abs(baseAmount) * priceUsd;
          rows.push({
            chainId: market.chainId,
            tokenMarketId: market.id,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: event.blockNumber,
            blockTimestamp,
            amount0Raw: event.amount0.toString(),
            amount1Raw: event.amount1.toString(),
            priceUsd,
            volumeUsd,
            side: baseAmount > 0 ? 'sell' : 'buy', // pool received base token => someone sold it
          });

          if (!minTs || blockTimestamp < minTs) minTs = blockTimestamp;
          if (!maxTs || blockTimestamp > maxTs) maxTs = blockTimestamp;
        }

        // Persist first, advance the cursor only once that succeeds — a thrown error here
        // propagates out and leaves the cursor exactly where it was, so a persistence
        // failure is retried next tick rather than skipped.
        if (rows.length > 0) {
          await prisma.swap.createMany({ data: rows, skipDuplicates: true });
          totalSwaps += rows.length;
        }

        cursor = chunkEnd;
        await prisma.ingestionCursor.update({
          where: { tokenMarketId: market.id },
          data: { lastProcessedBlock: cursor },
        });
        await sleep(RPC_CALL_DELAY_MS);
      }

      if (totalSwaps > 0) {
        this.logger.info(
          { pool: market.pairAddress, symbol: market.token.symbol, swaps: totalSwaps, fromBlock: cursorBlock.toString(), toBlock: targetBlock.toString() },
          'Ingested swaps',
        );
        await this.upsertCandlesFromSwaps(market.id, minTs!, maxTs!);
      }
    }

    // Recomputed every tick — including one with zero new swaps — so volume24hUsd and
    // priceChange24hPct decay correctly as old activity ages out of the 24h window rather
    // than holding a stale high-water mark forever. See recomputeRollups.
    await this.recomputeRollups(market.id);
  }

  /**
   * Upserts candles for the given time range directly from `swaps` (the authoritative
   * source). Idempotent: re-running for the same range always produces the same candle
   * rows. Only called when new swaps were actually found this tick — see
   * `recomputeRollups` for the part of the pipeline that must still run even when none were.
   */
  private async upsertCandlesFromSwaps(tokenMarketId: string, fromTs: Date, toTs: Date): Promise<void> {
    const paddedFrom = new Date(fromTs.getTime() - BUCKET_MINUTES * 60_000);

    await prisma.$executeRaw`
      INSERT INTO candles (token_market_id, bucket_start, open, high, low, close, volume_usd)
      SELECT
        ${tokenMarketId}::text,
        time_bucket(${`${BUCKET_MINUTES} minutes`}::interval, block_timestamp) AS bucket_start,
        (array_agg(price_usd ORDER BY block_timestamp ASC))[1] AS open,
        MAX(price_usd) AS high,
        MIN(price_usd) AS low,
        (array_agg(price_usd ORDER BY block_timestamp DESC))[1] AS close,
        SUM(volume_usd) AS volume_usd
      FROM swaps
      WHERE token_market_id = ${tokenMarketId}::text
        AND block_timestamp >= ${paddedFrom}
        AND block_timestamp <= ${toTs}
      GROUP BY 1, 2
      ON CONFLICT (token_market_id, bucket_start)
      DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                    close = EXCLUDED.close, volume_usd = EXCLUDED.volume_usd
    `;
  }

  /**
   * Refreshes the 24h volume/price-change cache on TokenMarket from `candles` (never the
   * other way around). Must run every ingestion tick — including one with zero new swaps —
   * because the 24h window is time-based, not swap-based: old candles age out of it purely
   * from wall-clock time passing, and both cached figures need to reflect that decay, not
   * hold whatever value the last tick with real activity left behind.
   */
  private async recomputeRollups(tokenMarketId: string): Promise<void> {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const volumeRows = await prisma.candle.aggregate({
      where: { tokenMarketId, bucketStart: { gte: since24h } },
      _sum: { volumeUsd: true },
    });

    const oldestRelevantCandle = await prisma.candle.findFirst({
      where: { tokenMarketId, bucketStart: { lte: since24h } },
      orderBy: { bucketStart: 'desc' },
    });
    const oldestCandleOverall = await prisma.candle.findFirst({
      where: { tokenMarketId },
      orderBy: { bucketStart: 'asc' },
    });

    let priceChange24hPct: number | null = null;
    const current = await prisma.tokenMarket.findUniqueOrThrow({ where: { id: tokenMarketId } });
    const referenceCandle = oldestRelevantCandle ?? oldestCandleOverall;
    const haveFullDay = oldestCandleOverall !== null && oldestCandleOverall.bucketStart <= since24h;
    if (referenceCandle && current.priceUsd !== null && haveFullDay) {
      const oldPrice = Number(referenceCandle.close);
      if (oldPrice > 0) {
        priceChange24hPct = ((Number(current.priceUsd) - oldPrice) / oldPrice) * 100;
      }
    }

    // Once at least one swap has ever been indexed for this market, the 24h window is
    // fully known and must reflect it exactly — including 0 once every swap behind the
    // current figure has aged out of it. Before that first swap, `undefined` (leave the
    // column at its default null) is still the honest "unknown," not "confirmed zero" —
    // see the volume24hUsd comment on TokenMarket in schema.prisma.
    const volume24hUsd = oldestCandleOverall === null ? undefined : (volumeRows._sum.volumeUsd ?? 0);

    await prisma.tokenMarket.update({
      where: { id: tokenMarketId },
      data: {
        volume24hUsd,
        priceChange24hPct, // explicitly null until 24h of real history exists
      },
    });
  }

  private requireChainId(): number {
    if (this.chainId === null) throw new Error('MarketIngestionService.seed() must run before other methods');
    return this.chainId;
  }
}

function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
function bigintMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
