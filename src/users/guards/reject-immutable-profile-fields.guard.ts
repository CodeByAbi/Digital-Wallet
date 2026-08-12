import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';

const FORBIDDEN_FIELDS = ['phone_number', 'pin'] as const;
const ALLOWED_FIELDS = ['first_name', 'last_name', 'address'] as const;

/**
 * Single auditable gate for PATCH /profile's immutable-field rule (deviation
 * from ROADMAP.md's original plan: phone_number/pin are REJECTED, not
 * silently ignored — see ROADMAP.md item 4 and SRS.md Section 3.5).
 *
 * Implemented as a Guard, not a Pipe: Nest's request lifecycle runs
 * Middleware -> Guards -> Interceptors -> Pipes -> Handler, so a Pipe would
 * only see the body *after* the global ValidationPipe already stripped
 * phone_number/pin via whitelist:true — too late to tell "field sent as
 * null/empty string" apart from "field never sent". A Guard reads
 * request.body directly, before ValidationPipe touches it.
 */
@Injectable()
export class RejectImmutableProfileFieldsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const body = (request.body ?? {}) as Record<string, unknown>;

    const presentForbidden = FORBIDDEN_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    );
    if (presentForbidden.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `${presentForbidden.join(', ')} cannot be changed via this endpoint`,
      );
    }

    const hasAllowedField = ALLOWED_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    );
    if (!hasAllowedField) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `At least one of ${ALLOWED_FIELDS.join(', ')} must be provided`,
      );
    }

    return true;
  }
}
