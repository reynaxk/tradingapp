import { IsString, IsUUID, Matches } from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

export class SubmitTransactionDto {
  @IsUUID()
  quoteId!: string;

  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress!: string;

  @IsString()
  @Matches(TX_HASH_REGEX, { message: 'txHash must be a well-formed 32-byte transaction hash' })
  txHash!: string;
}
