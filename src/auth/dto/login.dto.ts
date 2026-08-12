import { IsNotEmpty, Matches } from 'class-validator';

/**
 * DTO for POST /api/v1/login — validated per SRS Section 3.2
 */
export class LoginDto {
  @IsNotEmpty()
  @Matches(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, {
    message:
      'phone_number must be a valid Indonesian phone number',
  })
  phone_number!: string;

  /**
   * Exactly 6 numeric digits
   */
  @IsNotEmpty()
  @Matches(/^\d{6}$/, {
    message: 'pin must be exactly 6 numeric digits',
  })
  pin!: string;
}
