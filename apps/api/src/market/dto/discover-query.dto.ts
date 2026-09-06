import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DISCOVER_SORTS = ['score', 'volume', 'liquidity', 'priceChange'] as const;
export type DiscoverSortValue = (typeof DISCOVER_SORTS)[number];

export class DiscoverQueryDto {
  @IsOptional()
  @IsIn(DISCOVER_SORTS)
  sort: DiscoverSortValue = 'score';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
