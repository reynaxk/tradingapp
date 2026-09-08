-- Phase 6: retention, watchlists & social sharing. See docs/PHASE6_RETENTION_SOCIAL.md.
--
-- Two new tables (token_watches, saved_searches), one new NotificationType value
-- (WATCHED_TOKEN_ACTIVITY) gated by its own notification_preferences column, and three new
-- columns on users backing the return-loop/streak signal. No changes to any existing
-- table's existing columns.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WATCHED_TOKEN_ACTIVITY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_discovery_seen_at" TIMESTAMP(3),
ADD COLUMN     "current_streak_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "longest_streak_days" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "watched_token_activity" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "token_watches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_market_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_watches_user_id_token_market_id_key" ON "token_watches"("user_id", "token_market_id");

-- CreateIndex
CREATE INDEX "token_watches_user_id_created_at_idx" ON "token_watches"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "token_watches_token_market_id_idx" ON "token_watches"("token_market_id");

-- CreateIndex
CREATE INDEX "saved_searches_user_id_created_at_idx" ON "saved_searches"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "token_watches" ADD CONSTRAINT "token_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_watches" ADD CONSTRAINT "token_watches_token_market_id_fkey" FOREIGN KEY ("token_market_id") REFERENCES "token_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
