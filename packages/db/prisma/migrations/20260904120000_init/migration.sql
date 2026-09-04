-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- CreateTable
CREATE TABLE "chains" (
    "id" SERIAL NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native_symbol" TEXT NOT NULL,
    "rpc_config_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER,
    "logo_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_markets" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_id" TEXT NOT NULL,
    "quote_token_id" TEXT NOT NULL,
    "dex" TEXT,
    "pair_address" TEXT NOT NULL,
    "liquidity_usd" DECIMAL(38,18),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_markets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chains_identifier_key" ON "chains"("identifier");

-- CreateIndex
CREATE INDEX "tokens_chain_id_idx" ON "tokens"("chain_id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_chain_id_contract_address_key" ON "tokens"("chain_id", "contract_address");

-- CreateIndex
CREATE INDEX "token_markets_token_id_idx" ON "token_markets"("token_id");

-- CreateIndex
CREATE INDEX "token_markets_quote_token_id_idx" ON "token_markets"("quote_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_markets_chain_id_pair_address_key" ON "token_markets"("chain_id", "pair_address");

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_markets" ADD CONSTRAINT "token_markets_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_markets" ADD CONSTRAINT "token_markets_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_markets" ADD CONSTRAINT "token_markets_quote_token_id_fkey" FOREIGN KEY ("quote_token_id") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
