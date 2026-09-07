-- Phase 3: wallet ownership and trading. See docs/TRADING.md.
--
-- `users.wallet_address` is dropped, not renamed: Phase 2 never implemented the
-- verification that would have populated it (see the field's own comment in the prior
-- schema), so every real deployment has it `NULL` on every row — dropping it loses no
-- data. It's replaced by `wallets.user_id` (a proper one-to-many: one User can now hold
-- several verified wallets, per docs/TRADING.md#wallet-ownership, instead of the
-- single-wallet shape Phase 2 only ever half-built).
--
-- Every new/altered column here is nullable or has a safe default, so this applies
-- cleanly on top of live Phase 1 + Phase 2 data.

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_wallet_address_fkey";

-- DropIndex
DROP INDEX "users_wallet_address_key";

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "last_used_at" TIMESTAMP(3),
ADD COLUMN     "user_id" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" DROP COLUMN "wallet_address";

-- CreateTable
CREATE TABLE "wallet_challenges" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "token_market_id" TEXT NOT NULL,
    "input_token" TEXT NOT NULL,
    "output_token" TEXT NOT NULL,
    "input_amount" TEXT NOT NULL,
    "expected_output_amount" TEXT NOT NULL,
    "min_output_amount" TEXT NOT NULL,
    "price_usd" DECIMAL(38,18),
    "price_impact_bps" INTEGER,
    "slippage_bps" INTEGER NOT NULL,
    "platform_fee_bps" INTEGER NOT NULL,
    "platform_fee_amount" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_quote_id" TEXT,
    "unsigned_tx" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "token_market_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "input_token" TEXT NOT NULL,
    "output_token" TEXT NOT NULL,
    "input_amount" TEXT NOT NULL,
    "expected_output_amount" TEXT NOT NULL,
    "platform_fee_amount" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_challenges_nonce_key" ON "wallet_challenges"("nonce");

-- CreateIndex
CREATE INDEX "wallet_challenges_address_idx" ON "wallet_challenges"("address");

-- CreateIndex
CREATE INDEX "wallet_challenges_expires_at_idx" ON "wallet_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "trade_quotes_user_id_created_at_idx" ON "trade_quotes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "trade_quotes_expires_at_idx" ON "trade_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "trade_transactions_quote_id_key" ON "trade_transactions"("quote_id");

-- CreateIndex
CREATE INDEX "trade_transactions_user_id_created_at_idx" ON "trade_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "trade_transactions_status_idx" ON "trade_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "trade_transactions_chain_id_tx_hash_key" ON "trade_transactions"("chain_id", "tx_hash");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_quotes" ADD CONSTRAINT "trade_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_quotes" ADD CONSTRAINT "trade_quotes_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_quotes" ADD CONSTRAINT "trade_quotes_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "trade_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
