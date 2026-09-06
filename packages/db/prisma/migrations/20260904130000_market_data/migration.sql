-- Phase 1: market data (current-state cache on token_markets, plus swaps/candles/cursors
-- as the authoritative history those fields are derived from). See docs/MARKET_DATA.md.

-- AlterTable
ALTER TABLE "token_markets"
  ADD COLUMN "fee_tier" INTEGER,
  ADD COLUMN "price_usd" DECIMAL(38,18),
  ADD COLUMN "volume_24h_usd" DECIMAL(38,18),
  ADD COLUMN "price_change_24h_pct" DECIMAL(12,4),
  ADD COLUMN "market_cap_usd" DECIMAL(38,2),
  ADD COLUMN "last_price_update_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "token_markets_liquidity_usd_idx" ON "token_markets"("liquidity_usd");

-- CreateTable
CREATE TABLE "swaps" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_market_id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_number" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "amount0_raw" TEXT NOT NULL,
    "amount1_raw" TEXT NOT NULL,
    "price_usd" DECIMAL(38,18) NOT NULL,
    "volume_usd" DECIMAL(38,18) NOT NULL,
    "side" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swaps_token_market_id_block_timestamp_idx" ON "swaps"("token_market_id", "block_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "swaps_chain_id_tx_hash_log_index_key" ON "swaps"("chain_id", "tx_hash", "log_index");

-- AddForeignKey
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "candles" (
    "token_market_id" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(38,18) NOT NULL,
    "high" DECIMAL(38,18) NOT NULL,
    "low" DECIMAL(38,18) NOT NULL,
    "close" DECIMAL(38,18) NOT NULL,
    "volume_usd" DECIMAL(38,18) NOT NULL,

    CONSTRAINT "candles_pkey" PRIMARY KEY ("token_market_id","bucket_start")
);

-- AddForeignKey
ALTER TABLE "candles" ADD CONSTRAINT "candles_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Convert candles into a Timescale hypertable, partitioned by its own bucket_start. Its
-- composite primary key already includes bucket_start, which is what Timescale requires.
-- `swaps` is deliberately NOT converted yet: its idempotency key (chain_id, tx_hash,
-- log_index) doesn't include block_timestamp, and TimescaleDB requires the partitioning
-- column be part of every unique constraint on a hypertable. At Phase 1's bounded market
-- count this is a non-issue; revisit when swap volume actually justifies it (see
-- docs/MARKET_DATA.md).
SELECT create_hypertable('candles', 'bucket_start', if_not_exists => TRUE, migrate_data => TRUE);

-- CreateTable
CREATE TABLE "ingestion_cursors" (
    "token_market_id" TEXT NOT NULL,
    "last_processed_block" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_cursors_pkey" PRIMARY KEY ("token_market_id")
);

-- AddForeignKey
ALTER TABLE "ingestion_cursors" ADD CONSTRAINT "ingestion_cursors_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
