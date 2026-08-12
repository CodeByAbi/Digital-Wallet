import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { RejectImmutableProfileFieldsPipe } from './reject-immutable-profile-fields.pipe';

describe('RejectImmutableProfileFieldsPipe', () => {
  let pipe: RejectImmutableProfileFieldsPipe;

  beforeEach(() => {
    pipe = new RejectImmutableProfileFieldsPipe();
  });

  it('passes through a body with only allowed fields', () => {
    const body = { first_name: 'Guntur', address: 'Jl. Baru No. 2' };
    expect(pipe.transform(body)).toEqual(body);
  });

  it('rejects when phone_number is present, even as an empty string', () => {
    let caught: AppException | undefined;
    try {
      pipe.transform({ first_name: 'Guntur', phone_number: '' });
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
    expect(caught?.errorMessage).toContain('phone_number');
  });

  it('rejects when pin is present, even as null', () => {
    let caught: AppException | undefined;
    try {
      pipe.transform({ first_name: 'Guntur', pin: null });
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
    expect(caught?.errorMessage).toContain('pin');
  });

  it('rejects the whole request (does not report only one field) when both are present', () => {
    let caught: AppException | undefined;
    try {
      pipe.transform({ phone_number: '08111234567', pin: '123456' });
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught?.errorMessage).toContain('phone_number');
    expect(caught?.errorMessage).toContain('pin');
  });

  it('rejects an empty body', () => {
    let caught: AppException | undefined;
    try {
      pipe.transform({});
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
  });

  it('rejects a null/undefined body the same as empty', () => {
    expect(() => pipe.transform(undefined)).toThrow(AppException);
  });
});
