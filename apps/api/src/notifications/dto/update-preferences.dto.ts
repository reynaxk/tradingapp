import { IsBoolean, IsOptional } from 'class-validator';

/** Every field optional — a partial update merges onto the caller's current preferences
 *  (or the shipped defaults if they've never set any). See NotificationService#updatePreferences. */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  follows?: boolean;

  @IsOptional()
  @IsBoolean()
  likes?: boolean;

  @IsOptional()
  @IsBoolean()
  followedTraderTrades?: boolean;

  @IsOptional()
  @IsBoolean()
  whaleTrades?: boolean;

  @IsOptional()
  @IsBoolean()
  trendingTokens?: boolean;
}
