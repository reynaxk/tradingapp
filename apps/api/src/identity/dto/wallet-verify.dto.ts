import { IsString, MaxLength, MinLength } from 'class-validator';

export class WalletVerifyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nonce!: string;

  /** A hex-encoded ECDSA signature — length varies slightly by wallet/signature scheme, so
   *  this is deliberately not regex-pinned to exactly 132 chars; verifyEvmSignature is the
   *  real validation, and it rejects anything malformed without throwing. */
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  signature!: string;
}
