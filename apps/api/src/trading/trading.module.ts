import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ZeroExSwapRouter } from './router/zero-ex-router.service';
import { SWAP_ROUTER } from './router/swap-router.token';
import { QuoteService } from './quote.service';
import { SafetyService } from './safety.service';
import { TradingController } from './trading.controller';
import { TransactionService } from './transaction.service';

/**
 * Owns swap quoting, transaction preparation/tracking, and trading fees — see
 * docs/TRADING.md. Never signs a transaction (see docs/WALLET_SECURITY.md); the router
 * adapter is the only place that knows which aggregator Fomo integrates with — see
 * docs/TRADING.md#provider.
 */
@Module({
  imports: [IdentityModule],
  controllers: [TradingController],
  providers: [
    QuoteService,
    SafetyService,
    TransactionService,
    { provide: SWAP_ROUTER, useClass: ZeroExSwapRouter },
  ],
})
export class TradingModule {}
