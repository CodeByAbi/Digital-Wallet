import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * DTO for POST /api/v1/register — validated per SRS Section 3.1
 */
export class RegisterDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  first_name!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  last_name!: string;

  /**
   * Indonesian phone number format per SRS 6 Validation Rules:
   * ^(\+62|62|0)8[1-9][0-9]{6,10}$
   */
  @IsNotEmpty()
  @Matches(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, {
    message:
      'phone_number must be a valid Indonesian phone number (e.g. 08111234567)',
  })
  phone_number!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  address!: string;

  /**
   * Exactly 6 numeric digits — per SRS 6 & PRD Assumption #5
   */
  @IsNotEmpty()
  @Matches(/^\d{6}$/, {
    message: 'pin must be exactly 6 numeric digits',
  })
  pin!: string;
}
