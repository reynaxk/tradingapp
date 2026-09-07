import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@fomo/db';
import {
  calculateFeeAmount,
  calculateMinOutputAmount,
  classifyPriceImpactBps,
  normalizeEvmAddress,
  SAFETY_DISCLAIMER,
  TRADING_DEFAULTS,
  type TradeQuoteDto,
  type TradeSide,
} from '@fomo/domain';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits, parseUnits } from 'viem';
import type { Env } from '../config/env';
import { SWAP_ROUTER } from './router/swap-router.token';
import type { SwapRouter } from './router/swap-router.interface';
import { SafetyService, type TradableMarket } from './safety.service';

export interface CreateQuoteParams {
  userId: string;
  walletAddress: string;
  tokenAddress: string;
  side: TradeSide;
  /** A decimal string denominated in the *input* token for this side — the quote token for
   *  BUY, the base token for SELL. Never a JS number, see docs/TRADING.md#financial-precision. */
  amount: string;
  slippageBps: number;
}

/**
 * Orchestrates one quote: validates the request, confirms the caller actually owns the
 * wallet it's for, asks the router for a real price, applies the platform fee, and
 * persists the result so it can be checked again (never trusted blindly) at submission
 * time. See docs/TRADING.md#quote-system.
 */
@Injectable()
export class QuoteService {
  private readonly feeBps: number;
  private readonly feeRecipient: string;
  private readonly chainId: number;

  constructor(
    private readonly safety: SafetyService,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.feeBps = config.get('PLATFORM_FEE_BPS', { infer: true });
    this.feeRecipient = config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true });
    this.chainId = config.get('CHAIN_ID', { infer: true });
    this.logger.setContext('QuoteService');
  }

  async createQuote(params: CreateQuoteParams): Promise<TradeQuoteDto> {
    const walletAddress = normalizeEvmAddress(params.walletAddress);
    await this.assertWalletOwnership(params.userId, walletAddress);

    const market = await this.safety.assertTradable(params.tokenAddress);
    const { inputToken, outputToken } = resolveTokens(market, params.side);

    const inputAmountRaw = parseInputAmount(params.amount, inputToken.decimals!);

    const routerQuote = await this.router.getQuote({
      chainId: this.chainId,
      sellToken: inputToken.contractAddress,
      buyToken: outputToken.contractAddress,
      sellAmountRaw: inputAmountRaw.toString(),
      taker: walletAddress,
      slippageBps: params.slippageBps,
      feeRecipient: this.feeRecipient,
      feeBps: this.feeBps,
    });
    if (!routerQuote) {
      throw new UnprocessableEntityException('No live quote is available for this trade right now — try again shortly');
    }

    const buyAmountRaw = BigInt(routerQuote.buyAmountRaw);
    const providerMinBuyAmountRaw = BigInt(routerQuote.minBuyAmountRaw);
    // Sanity-check the provider's own floor against ours — never trust it blindly. If it's
    // looser than what the requested slippage demands, something is wrong upstream.
    const ourMinOutputRaw = calculateMinOutputAmount(buyAmountRaw, params.slippageBps);
    if (providerMinBuyAmountRaw < ourMinOutputRaw) {
      this.logger.warn(
        { providerMinBuyAmountRaw: providerMinBuyAmountRaw.toString(), ourMinOutputRaw: ourMinOutputRaw.toString() },
        'quote rejected: provider minBuyAmount looser than the requested slippage tolerance',
      );
      throw new UnprocessableEntityException('The quote returned did not honor the requested slippage tolerance');
    }

    const platformFeeAmountRaw = routerQuote.feeAmountRaw
      ? BigInt(routerQuote.feeAmountRaw)
      : calculateFeeAmount(buyAmountRaw, this.feeBps);

    const priceImpactLevel = classifyPriceImpactBps(routerQuote.priceImpactBps);
    const expiresAt = new Date(Date.now() + TRADING_DEFAULTS.quoteTtlSeconds * 1000);

    const quote = await prisma.tradeQuote.create({
      data: {
        userId: params.userId,
        walletAddress,
        chainId: this.chainId,
        side: params.side,
        tokenMarketId: market.id,
        inputToken: inputToken.contractAddress,
        outputToken: outputToken.contractAddress,
        inputAmount: inputAmountRaw.toString(),
        expectedOutputAmount: buyAmountRaw.toString(),
        minOutputAmount: providerMinBuyAmountRaw.toString(),
        priceUsd: market.priceUsd,
        priceImpactBps: routerQuote.priceImpactBps,
        slippageBps: params.slippageBps,
        platformFeeBps: this.feeBps,
        platformFeeAmount: platformFeeAmountRaw.toString(),
        provider: routerQuote.provider,
        providerQuoteId: routerQuote.providerQuoteId,
        unsignedTx: routerQuote.unsignedTx,
        expiresAt,
      },
    });

    this.logger.info({ quoteId: quote.id, side: params.side, tokenMarketId: market.id }, 'quote created');

    return {
      id: quote.id,
      chainId: this.chainId,
      side: params.side,
      token: toTokenDto(market.token),
      quoteToken: toTokenDto(market.quoteToken),
      inputAmount: inputAmountRaw.toString(),
      expectedOutputAmount: buyAmountRaw.toString(),
      minOutputAmount: providerMinBuyAmountRaw.toString(),
      inputAmountFormatted: formatUnits(inputAmountRaw, inputToken.decimals!),
      expectedOutputAmountFormatted: formatUnits(buyAmountRaw, outputToken.decimals!),
      minOutputAmountFormatted: formatUnits(providerMinBuyAmountRaw, outputToken.decimals!),
      priceUsd: market.priceUsd === null ? null : Number(market.priceUsd),
      priceImpactBps: routerQuote.priceImpactBps,
      priceImpactLevel,
      slippageBps: params.slippageBps,
      platformFeeBps: this.feeBps,
      platformFeeAmount: platformFeeAmountRaw.toString(),
      platformFeeAmountFormatted: formatUnits(platformFeeAmountRaw, outputToken.decimals!),
      provider: routerQuote.provider,
      expiresAt: expiresAt.toISOString(),
      createdAt: quote.createdAt.toISOString(),
      unsignedTx: routerQuote.unsignedTx,
      safetyNote: SAFETY_DISCLAIMER,
      requiresApproval: routerQuote.requiresApproval,
      approvalSpender: routerQuote.approvalSpender,
    };
  }

  /** Never trust a client-supplied wallet address as proof it belongs to the caller — see
   *  docs/TRADING.md#authorization. */
  private async assertWalletOwnership(userId: string, walletAddress: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== userId || wallet.verifiedAt === null) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
  }
}

function resolveTokens(
  market: TradableMarket,
  side: TradeSide,
): { inputToken: TradableMarket['token']; outputToken: TradableMarket['quoteToken'] } {
  return side === 'BUY'
    ? { inputToken: market.quoteToken, outputToken: market.token }
    : { inputToken: market.token, outputToken: market.quoteToken };
}

function toTokenDto(token: { contractAddress: string; symbol: string | null; decimals: number | null }) {
  return { address: token.contractAddress, symbol: token.symbol, decimals: token.decimals! };
}

/** Parses a human decimal string (never a JS number) into exact raw integer units via
 *  viem's `parseUnits` — see docs/TRADING.md#financial-precision. Rejects non-positive or
 *  malformed input rather than silently coercing it. */
function parseInputAmount(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new UnprocessableEntityException('amount must be a positive decimal number');
  }
  let raw: bigint;
  try {
    raw = parseUnits(amount, decimals);
  } catch {
    throw new UnprocessableEntityException('amount could not be parsed for this token\'s decimals');
  }
  if (raw <= 0n) throw new UnprocessableEntityException('amount must be greater than zero');
  return raw;
}
