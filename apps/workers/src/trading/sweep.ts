import type { EvmChainDataProvider } from '@fomo/chain-adapters';
import { prisma } from '@fomo/db';
import { parseUnsignedTx, TRADING_DEFAULTS, transactionMatchesQuote } from '@fomo/domain';
import type { Logger } from 'pino';

/** Bounds one sweep tick's RPC work — a large backlog simply continues over several ticks,
 *  same philosophy as MarketIngestionService's MAX_BLOCKS_PER_TICK. */
const BATCH_SIZE = 50;

export interface TradeSweepResult {
  checked: number;
  confirmed: number;
  failed: number;
  expired: number;
}

/**
 * The eventual-consistency backstop for trade status — see
 * docs/TRADING.md#transaction-lifecycle. apps/api's TransactionService already refreshes a
 * PENDING transaction on-demand whenever someone actively looks at it; this sweep is what
 * resolves the ones nobody is watching (a closed tab, a backgrounded trade) so PENDING
 * doesn't linger forever. Same rule as everywhere else in trading: status only ever moves
 * in response to a real on-chain receipt, or — EXPIRED — after giving up on a bounded wait.
 * Never a fabricated confirmation.
 *
 * A successful receipt alone is never sufficient for CONFIRMED — see
 * docs/TRADING.md#transaction-integrity. This is a second, independent path to CONFIRMED
 * (apps/api's TransactionService#refreshStatus is the other), so it re-verifies the same
 * sender/destination/value/calldata match against the persisted quote before ever
 * confirming a trade — the sweep is not a lesser-checked backdoor around that gate.
 */
export class TradeSweepService {
  constructor(
    private readonly chainId: number,
    private readonly chainReader: EvmChainDataProvider,
    private readonly logger: Logger,
  ) {}

  async sweepPendingTransactions(): Promise<TradeSweepResult> {
    const pending = await prisma.tradeTransaction.findMany({
      where: { status: 'PENDING', chainId: this.chainId },
      orderBy: { submittedAt: 'asc' },
      take: BATCH_SIZE,
      include: { quote: true },
    });

    const result: TradeSweepResult = { checked: 0, confirmed: 0, failed: 0, expired: 0 };
    for (const row of pending) {
      result.checked += 1;
      try {
        const receiptStatus = await this.chainReader.getTransactionReceiptStatus(row.txHash);
        if (receiptStatus === 'success') {
          const expectedUnsignedTx = parseUnsignedTx(row.quote.unsignedTx);
          const onChain = expectedUnsignedTx ? await this.chainReader.getTransactionDetails(row.txHash) : null;
          const matches =
            expectedUnsignedTx !== null &&
            onChain !== null &&
            transactionMatchesQuote(onChain, { walletAddress: row.walletAddress, unsignedTx: expectedUnsignedTx });

          if (!matches) {
            this.logger.error(
              { transactionId: row.id, txHash: row.txHash },
              'trade sweep: receipt succeeded but the on-chain transaction does not match the persisted quote — marking FAILED, not CONFIRMED',
            );
            await prisma.tradeTransaction.update({
              where: { id: row.id },
              data: { status: 'FAILED', failureReason: 'On-chain transaction does not match the reviewed trade' },
            });
            result.failed += 1;
            continue;
          }

          await prisma.tradeTransaction.update({
            where: { id: row.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
          result.confirmed += 1;
        } else if (receiptStatus === 'reverted') {
          await prisma.tradeTransaction.update({
            where: { id: row.id },
            data: { status: 'FAILED', failureReason: 'Transaction reverted on-chain' },
          });
          result.failed += 1;
        } else {
          const ageMinutes = (Date.now() - row.submittedAt.getTime()) / 60_000;
          if (ageMinutes > TRADING_DEFAULTS.pendingTransactionTimeoutMinutes) {
            await prisma.tradeTransaction.update({
              where: { id: row.id },
              data: { status: 'EXPIRED', failureReason: 'No confirmation received within the expected time' },
            });
            result.expired += 1;
          }
          // Otherwise: no receipt yet and not stale — left PENDING, tried again next tick.
        }
      } catch (error) {
        // One bad row (a transient RPC hiccup) never aborts the rest of the batch.
        this.logger.error({ err: error, transactionId: row.id }, 'trade sweep: failed to refresh one transaction — will retry next tick');
      }
    }
    return result;
  }
}
