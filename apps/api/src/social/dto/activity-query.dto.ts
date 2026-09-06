import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class ActivityQueryDto {
  /** Opaque keyset cursor from a previous page's `nextCursor` — never a raw offset. An
   *  invalid/malformed value is treated as "no cursor" by the service, never a 400: see
   *  docs/SOCIAL.md#pagination. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  /** Scopes the feed to one token's activity — the token page's "who's trading this"
   *  section reuses the same feed machinery instead of a bespoke query. */
  @IsOptional()
  @Matches(EVM_ADDRESS_REGEX, { message: 'tokenAddress must be a valid EVM address' })
  tokenAddress?: string;
}
