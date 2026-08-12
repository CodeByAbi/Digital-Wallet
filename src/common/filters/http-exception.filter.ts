import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

/**
 * Global exception filter.
 * - AppException  → SRS 1.3 FAILED envelope with { code, message }
 * - ValidationPipe errors (400) → VALIDATION_ERROR with details array
 * - All other HttpException → generic FAILED envelope
 * - Non-Http errors → 500 INTERNAL_ERROR (no stack trace leaked)
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppException) {
      response.status(exception.getStatus()).json({
        status: 'FAILED',
        error: {
          code: exception.errorCode,
          message: exception.errorMessage,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse() as
        | string
        | { message: string | string[]; error?: string };

      // ValidationPipe fires a 400 with { message: string[], error: 'Bad Request' }
      if (
        status === HttpStatus.BAD_REQUEST &&
        typeof raw === 'object' &&
        Array.isArray((raw as { message: string | string[] }).message)
      ) {
        const messages = (raw as { message: string[] }).message;
        response.status(400).json({
          status: 'FAILED',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: messages.map((msg) => ({ message: msg })),
          },
        });
        return;
      }

      const message =
        typeof raw === 'string'
          ? raw
          : (raw as { message: string }).message ?? 'An error occurred';

      response.status(status).json({
        status: 'FAILED',
        error: {
          code: 'HTTP_ERROR',
          message,
        },
      });
      return;
    }

    // Unknown/unexpected error — log full details server-side, hide from client
    this.logger.error('Unhandled exception', exception);
    response.status(500).json({
      status: 'FAILED',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    });
  }
}
