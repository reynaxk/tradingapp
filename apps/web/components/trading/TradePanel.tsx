'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@fomo/ui';
import { isQuoteExpired, TRADING_DEFAULTS, type TradeQuoteDto, type TradeSide, type TradeTransactionDto } from '@fomo/domain';
import { erc20Abi } from 'viem';
import { useAccount } from 'wagmi';
import { base } from 'wagmi/chains';
import { sendTransaction, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { useWalletVerification } from '@/hooks/useWalletVerification';
import { wagmiConfig } from '@/lib/wagmi-config';
import { getQuote, getTransaction, submitTransaction } from '@/lib/trading-client';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { AmountInput } from './AmountInput';
import { SlippageControl } from './SlippageControl';
import { QuoteSummary } from './QuoteSummary';

export interface TradePanelProps {
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  quoteTokenAddress: string;
  quoteTokenSymbol: string | null;
  quoteTokenDecimals: number;
  initialSide?: TradeSide;
  onClose?: () => void;
}

type Step = 'form' | 'review' | 'approving' | 'signing' | 'submitted' | 'pending' | 'confirmed' | 'failed';

function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err && typeof (err as { shortMessage?: unknown }).shortMessage === 'string') {
    return (err as { shortMessage: string }).shortMessage;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

/**
 * The one shared trade flow every entry point (token page, activity "Trade" action) opens
 * — see docs/TRADING.md#trading-ui. Review → Confirm & sign → wallet popup → submitted →
 * pending → confirmed/failed, never skipping a step and never showing a false success.
 * This component never signs anything itself: `sendTransaction`/`writeContract` below hand
 * the unsigned transaction to whatever wallet wagmi has connected — the wallet is the only
 * thing that ever touches a private key. See docs/WALLET_SECURITY.md.
 */
export function TradePanel({
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  quoteTokenAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  initialSide = 'BUY',
  onClose,
}: TradePanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const walletVerification = useWalletVerification();

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(TRADING_DEFAULTS.defaultSlippageBps);
  const [refreshTick, setRefreshTick] = useState(0);

  const [quote, setQuote] = useState<TradeQuoteDto | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [step, setStep] = useState<Step>('form');
  const [approved, setApproved] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<TradeTransactionDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inputTokenAddress = side === 'BUY' ? quoteTokenAddress : tokenAddress;
  const inputTokenSymbol = side === 'BUY' ? quoteTokenSymbol : tokenSymbol;
  const inputTokenDecimals = side === 'BUY' ? quoteTokenDecimals : tokenDecimals;

  const onBase = chainId === base.id;
  const canQuote = isConnected && onBase && walletVerification.status === 'verified';

  // Debounced quote fetch — never fires for an empty/invalid amount, so opening the panel
  // never itself triggers an API call (see docs/TRADING.md#quote-system).
  useEffect(() => {
    if (!canQuote || !address) return;
    const amountNum = Number.parseFloat(amount);
    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setQuote(null);
      setQuoteStatus('idle');
      return;
    }
    setQuoteStatus('loading');
    setQuoteError(null);
    setApproved(false);
    const timeout = setTimeout(() => {
      getQuote({ side, tokenAddress, walletAddress: address, amount, slippageBps })
        .then((result) => {
          setQuote(result);
          setQuoteStatus('ready');
        })
        .catch((err: unknown) => {
          setQuote(null);
          setQuoteStatus('error');
          setQuoteError(err instanceof Error ? err.message : 'Could not get a quote');
        });
    }, 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuote, side, amount, slippageBps, address, tokenAddress, refreshTick]);

  // Ticks once a second only while a quote is live, purely to re-render the expiry check.
  useEffect(() => {
    if (!quote) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [quote]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const isExpired = quote !== null && isQuoteExpired(new Date(quote.expiresAt), new Date(now));

  function pollTransactionStatus(id: string) {
    pollRef.current = setInterval(() => {
      getTransaction(id)
        .then((updated) => {
          if (!updated) return; // transient — try again next tick rather than erroring
          setTransaction(updated);
          if (updated.status !== 'PENDING') {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep(updated.status === 'CONFIRMED' ? 'confirmed' : 'failed');
          }
        })
        .catch(() => {
          // A transient read failure — the next tick tries again; the transaction record
          // itself is unaffected.
        });
    }, 4000);
  }

  async function handleApprove() {
    if (!quote?.approvalSpender) return;
    setFlowError(null);
    setStep('approving');
    try {
      const hash = await writeContract(wagmiConfig, {
        address: inputTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.approvalSpender as `0x${string}`, BigInt(quote.inputAmount)],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setApproved(true);
      setStep('review');
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('review');
    }
  }

  async function handleConfirmAndSign() {
    if (!quote || !address) return;
    if (isQuoteExpired(new Date(quote.expiresAt))) {
      setFlowError('This quote just expired — refresh it before signing.');
      return;
    }
    setFlowError(null);
    setStep('signing');
    try {
      const hash = await sendTransaction(wagmiConfig, {
        to: quote.unsignedTx.to as `0x${string}`,
        data: quote.unsignedTx.data as `0x${string}`,
        value: BigInt(quote.unsignedTx.value),
        gas: quote.unsignedTx.gas ? BigInt(quote.unsignedTx.gas) : undefined,
        maxFeePerGas: quote.unsignedTx.maxFeePerGas ? BigInt(quote.unsignedTx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: quote.unsignedTx.maxPriorityFeePerGas ? BigInt(quote.unsignedTx.maxPriorityFeePerGas) : undefined,
      });
      setStep('submitted');
      const recorded = await submitTransaction({ quoteId: quote.id, walletAddress: address, txHash: hash });
      setTransaction(recorded);
      setStep('pending');
      pollTransactionStatus(recorded.id);
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('review');
    }
  }

  function resetToForm() {
    setStep('form');
    setQuote(null);
    setQuoteStatus('idle');
    setTransaction(null);
    setFlowError(null);
    setAmount('');
  }

  // --- Gating states: connect -> right network -> verify ---------------------------------

  if (!isConnected) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Connect a wallet to trade — Fomo never holds your funds or signs on your behalf.</p>
        <ConnectWalletButton />
      </Panel>
    );
  }

  if (!onBase) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Your wallet is on the wrong network for this trade.</p>
        <ConnectWalletButton />
      </Panel>
    );
  }

  if (walletVerification.status !== 'verified') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Verify this wallet with a free signature (no gas, no transaction) before trading with it.</p>
        <Button
          type="button"
          onClick={() => void walletVerification.verify()}
          disabled={walletVerification.status === 'verifying' || walletVerification.status === 'checking'}
        >
          {walletVerification.status === 'verifying' ? 'Check your wallet…' : 'Verify wallet'}
        </Button>
        {walletVerification.status === 'rejected' && walletVerification.error && (
          <p className="font-body text-xs text-down">{walletVerification.error}</p>
        )}
      </Panel>
    );
  }

  // --- Post-trade states -------------------------------------------------------------------

  if (step === 'submitted' || step === 'pending' || step === 'confirmed' || step === 'failed') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <TradeStatusView step={step} transaction={transaction} chainId={base.id} onDone={resetToForm} />
      </Panel>
    );
  }

  // --- Review step -------------------------------------------------------------------------

  if (step === 'review' || step === 'approving' || step === 'signing') {
    if (!quote) return null;
    return (
      <Panel title="Review trade" onClose={onClose} onBack={step === 'review' ? () => setStep('form') : undefined}>
        <QuoteSummary quote={quote} />
        {isExpired && (
          <div className="rounded-lg bg-down/10 px-3 py-2 font-body text-xs text-down">
            This quote expired. <button type="button" className="underline" onClick={() => { setRefreshTick((n) => n + 1); setStep('form'); }}>Refresh it</button> before continuing.
          </div>
        )}
        {flowError && <p className="font-body text-xs text-down">{flowError}</p>}
        {quote.requiresApproval && !approved && (
          <Button type="button" onClick={() => void handleApprove()} disabled={step === 'approving' || isExpired}>
            {step === 'approving' ? 'Approving…' : `1. Approve ${side === 'BUY' ? quote.quoteToken.symbol : quote.token.symbol}`}
          </Button>
        )}
        <Button
          type="button"
          onClick={() => void handleConfirmAndSign()}
          disabled={isExpired || step === 'signing' || (quote.requiresApproval && !approved)}
        >
          {step === 'signing' ? 'Confirm in your wallet…' : quote.requiresApproval ? '2. Confirm & sign' : 'Confirm & sign'}
        </Button>
      </Panel>
    );
  }

  // --- Form step ---------------------------------------------------------------------------

  return (
    <Panel title="Trade" onClose={onClose}>
      <div className="flex rounded-lg bg-surface-raised p-1">
        {(['BUY', 'SELL'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSide(option);
              setAmount('');
            }}
            className={cn(
              'flex-1 rounded-md py-1.5 font-body text-sm font-semibold transition-colors',
              side === option ? (option === 'BUY' ? 'bg-up text-white' : 'bg-down text-white') : 'text-ink-600',
            )}
          >
            {option === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <AmountInput
        value={amount}
        onChange={setAmount}
        inputTokenAddress={inputTokenAddress}
        inputTokenSymbol={inputTokenSymbol}
        inputTokenDecimals={inputTokenDecimals}
      />

      <SlippageControl valueBps={slippageBps} onChange={setSlippageBps} />

      {quoteStatus === 'error' && <p className="font-body text-xs text-down">{quoteError}</p>}

      {quoteStatus === 'ready' && quote && <QuoteSummary quote={quote} />}

      <Button type="button" disabled={quoteStatus !== 'ready' || !quote} onClick={() => setStep('review')} className="w-full">
        {quoteStatus === 'loading' ? 'Getting quote…' : 'Review trade'}
      </Button>
    </Panel>
  );
}

function Panel({ title, onClose, onBack, children }: { title: string; onClose?: () => void; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back" className="text-ink-600 hover:text-ink-900">
              ←
            </button>
          )}
          <h2 className="font-display text-base font-semibold text-ink-900">{title}</h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-600 hover:text-ink-900">
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function TradeStatusView({
  step,
  transaction,
  chainId,
  onDone,
}: {
  step: Extract<Step, 'submitted' | 'pending' | 'confirmed' | 'failed'>;
  transaction: TradeTransactionDto | null;
  chainId: number;
  onDone: () => void;
}) {
  const explorerUrl = transaction ? explorerTxUrl(chainId, transaction.txHash) : null;

  return (
    <div className="space-y-3 text-center">
      {step === 'submitted' && <p className="font-body text-sm text-ink-600">Transaction submitted — waiting for it to be picked up…</p>}
      {step === 'pending' && <p className="font-body text-sm text-ink-600">Waiting for confirmation on-chain…</p>}
      {step === 'confirmed' && <p className="font-body text-sm font-semibold text-up">Trade confirmed ✓</p>}
      {step === 'failed' && (
        <p className="font-body text-sm font-semibold text-down">
          {transaction?.status === 'EXPIRED' ? 'No confirmation was received in time.' : 'This trade failed on-chain.'}
        </p>
      )}
      {transaction?.failureReason && <p className="font-body text-xs text-ink-600">{transaction.failureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View on Basescan
        </a>
      )}
      {(step === 'confirmed' || step === 'failed') && (
        <Button type="button" variant="secondary" onClick={onDone} className="w-full">
          Done
        </Button>
      )}
    </div>
  );
}

function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === base.id) return `https://basescan.org/tx/${txHash}`;
  return null;
}
