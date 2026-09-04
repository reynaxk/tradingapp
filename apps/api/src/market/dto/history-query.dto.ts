import { IsIn, IsOptional } from 'class-validator';
import { TIMEFRAMES, type Timeframe } from '@fomo/domain';

export class HistoryQueryDto {
  @IsOptional()
  @IsIn(TIMEFRAMES)
  timeframe: Timeframe = '1D';
}
