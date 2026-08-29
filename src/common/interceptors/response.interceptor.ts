import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful (2xx) controller return value into the SRS 1.3 SUCCESS envelope:
 *   { "status": "SUCCESS", "result": <original return value> }
 *
 * Controllers return plain objects; this interceptor adds the envelope.
 * Exceptions bypass this interceptor and are handled by HttpExceptionFilter.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data) => ({
        status: 'SUCCESS',
        result: data,
      })),
    );
  }
}
