import { Module } from '@nestjs/common';

/**
 * Empty on purpose. Owns swap quoting, server-side simulation/validation, and transaction
 * tracking starting in Phase 3. Never signs a transaction — see /docs/WALLET_SECURITY.md.
 */
@Module({})
export class TradingModule {}
