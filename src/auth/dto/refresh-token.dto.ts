import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for POST /api/v1/refresh-token — validated per SRS Section 3.3
 */
export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  refresh_token!: string;
}
