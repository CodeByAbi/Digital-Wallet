import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

/**
 * Query DTO for GET /api/v1/transactions — SRS Section 3.9.
 * page/limit arrive as query strings; @Type(() => Number) casts before
 * class-validator's @IsInt runs.
 */
export class ListTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
