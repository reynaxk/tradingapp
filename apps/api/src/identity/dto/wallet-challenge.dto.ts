import { Matches } from 'class-validator';

export class WalletChallengeDto {
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'address must be a valid EVM address' })
  address!: string;
}
