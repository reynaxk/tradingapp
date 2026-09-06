import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { TRADING_DEFAULTS } from '@fomo/domain';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class QuoteQueryDto {
  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @Matches(EVM_ADDRESS_REGEX, { message: 'tokenAddress must be a valid EVM address' })
  tokenAddress!: string;

  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress!: string;

  /** A decimal string, denominated in the input token for this side — see
   *  docs/TRADING.md#quote-system. Never parsed as a JS number. */
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'amount must be a positive decimal number' })
  amount!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(TRADING_DEFAULTS.minSlippageBps)
  @Max(TRADING_DEFAULTS.maxSlippageBps)
  slippageBps: number = TRADING_DEFAULTS.defaultSlippageBps;
}
