-- Phase 2: social layer. Wallet-first trader identity, optional User accounts, follows,
-- and activity likes — all additive, no existing Phase 1 column or table is altered
-- destructively. See docs/SOCIAL.md and docs/WALLET_SECURITY.md.
--
-- trader_address/sender_address on swaps and trade_count_24h/unique_traders_24h on
-- token_markets are nullable: existing Phase 1 rows predate this capture and stay null
-- (never backfilled with a guess) — every swap indexed from this migration onward
-- populates them for real.

-- AlterTable
ALTER TABLE "token_markets" ADD COLUMN     "trade_count_24h" INTEGER,
ADD COLUMN     "unique_traders_24h" INTEGER;

-- AlterTable
ALTER TABLE "swaps" ADD COLUMN     "sender_address" TEXT,
ADD COLUMN     "trader_address" TEXT;

-- CreateTable
CREATE TABLE "wallets" (
    "address" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_likes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "swap_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE INDEX "follows_wallet_address_idx" ON "follows"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "follows_user_id_wallet_address_key" ON "follows"("user_id", "wallet_address");

-- CreateIndex
CREATE INDEX "activity_likes_swap_id_idx" ON "activity_likes"("swap_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_likes_user_id_swap_id_key" ON "activity_likes"("user_id", "swap_id");

-- CreateIndex
CREATE INDEX "swaps_trader_address_block_timestamp_idx" ON "swaps"("trader_address", "block_timestamp");

-- CreateIndex
CREATE INDEX "swaps_block_timestamp_id_idx" ON "swaps"("block_timestamp", "id");

-- AddForeignKey
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_trader_address_fkey" FOREIGN KEY ("trader_address") REFERENCES "wallets"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_likes" ADD CONSTRAINT "activity_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_likes" ADD CONSTRAINT "activity_likes_swap_id_fkey" FOREIGN KEY ("swap_id") REFERENCES "swaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
