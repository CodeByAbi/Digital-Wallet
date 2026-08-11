import { HttpException, HttpStatus } from '@nestjs/common';

export interface AppErrorPayload {
  code: string;
  message: string;
}

/**
 * Custom exception that produces the SRS 1.3 FAILED envelope.
 * Usage: throw new AppException(HttpStatus.CONFLICT, 'PHONE_NUMBER_ALREADY_REGISTERED', 'Phone Number already registered');
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly errorCode: string,
    public readonly errorMessage: string,
  ) {
    super({ errorCode, errorMessage }, status);
  }
}
