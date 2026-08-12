import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { RejectImmutableProfileFieldsGuard } from './reject-immutable-profile-fields.guard';

const buildContext = (body: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  }) as unknown as ExecutionContext;

describe('RejectImmutableProfileFieldsGuard', () => {
  let guard: RejectImmutableProfileFieldsGuard;

  beforeEach(() => {
    guard = new RejectImmutableProfileFieldsGuard();
  });

  it('allows a body with only allowed fields', () => {
    const context = buildContext({
      first_name: 'Guntur',
      address: 'Jl. Baru No. 2',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects when phone_number is present, even as an empty string', () => {
    const context = buildContext({ first_name: 'Guntur', phone_number: '' });

    let caught: AppException | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
    expect(caught?.errorMessage).toContain('phone_number');
  });

  it('rejects when pin is present, even as null', () => {
    const context = buildContext({ first_name: 'Guntur', pin: null });

    let caught: AppException | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
    expect(caught?.errorMessage).toContain('pin');
  });

  it('mentions both fields when both are present (does not report only one)', () => {
    const context = buildContext({
      phone_number: '08111234567',
      pin: '123456',
    });

    let caught: AppException | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught?.errorMessage).toContain('phone_number');
    expect(caught?.errorMessage).toContain('pin');
  });

  it('rejects an empty body', () => {
    const context = buildContext({});

    let caught: AppException | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(caught?.errorCode).toBe('VALIDATION_ERROR');
  });

  it('rejects a null/undefined body the same as empty', () => {
    const context = buildContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });
});
