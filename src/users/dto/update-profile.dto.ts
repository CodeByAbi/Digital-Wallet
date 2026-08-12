import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * DTO for PATCH /api/v1/profile — validated per SRS Section 3.5.
 *
 * phone_number/pin are deliberately NOT declared here. Presence of either is
 * rejected upfront by RejectImmutableProfileFieldsGuard (see ../guards),
 * which runs on the raw body before this DTO's shape even applies — see that
 * file for why the rejection can't live in decorators on this class.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  last_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}
