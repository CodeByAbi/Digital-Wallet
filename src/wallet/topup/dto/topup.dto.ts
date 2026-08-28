import { IsInt, Min, Max } from 'class-validator';

const MIN_TOPUP_AMOUNT = 10_000; // PRD Assumption #4
const MAX_TOPUP_AMOUNT = 50_000_000; // SRS 3.6 — placeholder upper bound

/**
 * DTO for POST /api/v1/topup — validated per SRS Section 3.6.
 *
 * No @Type(() => Number) here on purpose: a string amount ("100000") must
 * stay a string through transform and fail @IsInt() rather than getting
 * silently coerced (TDD Section 10 edge case).
 */
export class TopupDto {
  @IsInt()
  @Min(MIN_TOPUP_AMOUNT)
  @Max(MAX_TOPUP_AMOUNT)
  amount!: number;
}
