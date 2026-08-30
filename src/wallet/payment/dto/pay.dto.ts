import {
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const MAX_PAYMENT_AMOUNT = 50_000_000; // mirrors topup upper bound — no spec value given

/**
 * DTO for POST /api/v1/pay — validated per SRS Section 3.7.
 * Idempotency-Key arrives as a header, not part of this body (see PayController).
 */
export class PayDto {
  @IsInt()
  @Min(1)
  @Max(MAX_PAYMENT_AMOUNT)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remarks?: string;
}
