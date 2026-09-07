-- Phase 4: notifications. See docs/NOTIFICATIONS.md.
--
-- Three new tables only — no changes to any existing table. `notifications` stores
-- references (actor user/wallet, swap, token market), never a precomputed title/body, so
-- copy always reflects the current state of the entity it points to. `dedupe_key` plus the
-- unique constraint below is this phase's idempotency guarantee: every creation path must
-- build the same key for the same real-world event, so retries can never duplicate a
-- notification.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOW', 'LIKE', 'FOLLOWED_TRADER_TRADE', 'WHALE_TRADE', 'TRENDING_TOKEN');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_wallet_address" TEXT,
    "swap_id" TEXT,
    "token_market_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "follows" BOOLEAN NOT NULL DEFAULT true,
    "likes" BOOLEAN NOT NULL DEFAULT true,
    "followed_trader_trades" BOOLEAN NOT NULL DEFAULT true,
    "whale_trades" BOOLEAN NOT NULL DEFAULT true,
    "trending_tokens" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "token_trending_state" (
    "token_market_id" TEXT NOT NULL,
    "is_trending" BOOLEAN NOT NULL DEFAULT false,
    "became_trending_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_trending_state_pkey" PRIMARY KEY ("token_market_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_type_dedupe_key_key" ON "notifications"("user_id", "type", "dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_swap_id_idx" ON "notifications"("swap_id");

-- CreateIndex
CREATE INDEX "notifications_token_market_id_idx" ON "notifications"("token_market_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_wallet_address_fkey" FOREIGN KEY ("actor_wallet_address") REFERENCES "wallets"("address") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_swap_id_fkey" FOREIGN KEY ("swap_id") REFERENCES "swaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_trending_state" ADD CONSTRAINT "token_trending_state_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
