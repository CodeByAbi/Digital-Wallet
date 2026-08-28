import {
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';

const MAX_TRANSFER_AMOUNT = 50_000_000; // mirrors topup/pay upper bound — no spec value given

/**
 * DTO for POST /api/v1/transfer — validated per SRS Section 3.8.
 * Idempotency-Key arrives as a header, not part of this body (see TransferController).
 */
export class TransferDto {
  /**
   * Same Indonesian phone format as RegisterDto (SRS 6 Validation Rules) —
   * target resolved to a user_id internally (PRD Assumption #1).
   */
  @IsNotEmpty()
  @Matches(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, {
    message:
      'target_phone_number must be a valid Indonesian phone number (e.g. 08111234567)',
  })
  target_phone_number!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TRANSFER_AMOUNT)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remarks?: string;
}
