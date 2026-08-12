import { Injectable, PipeTransform, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

const FORBIDDEN_FIELDS = ['phone_number', 'pin'] as const;
const ALLOWED_FIELDS = ['first_name', 'last_name', 'address'] as const;

/**
 * Single auditable gate for PATCH /profile's immutable-field rule (deviation
 * from ROADMAP.md: phone_number/pin are REJECTED, not silently ignored).
 *
 * Runs as a param-scoped pipe BEFORE the global ValidationPipe, so it sees
 * the raw parsed JSON body — the only way to tell "field sent as null/empty
 * string" apart from "field never sent". Once the body reaches a
 * class-transformer instance (UpdateProfileDto), that distinction is lost:
 * this project's ES2023 build target makes every declared class field an
 * own property from construction, so hasOwnProperty checks on the DTO
 * instance can't tell "present" from "absent" either way.
 */
@Injectable()
export class RejectImmutableProfileFieldsPipe implements PipeTransform {
  transform(value: unknown): unknown {
    const body = (value ?? {}) as Record<string, unknown>;

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

    return body;
  }
}
