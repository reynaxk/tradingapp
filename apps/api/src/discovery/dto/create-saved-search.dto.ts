import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSavedSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName?: string;
}
