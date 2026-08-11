import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

const buildContext = (
  headers: Record<string, string>,
): { context: ExecutionContext; request: AuthenticatedRequest } => {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtServiceMock: { verify: jest.Mock };
  let configServiceMock: { get: jest.Mock };

  beforeEach(() => {
    jwtServiceMock = { verify: jest.fn() };
    configServiceMock = { get: jest.fn().mockReturnValue('test-secret') };
    guard = new JwtAuthGuard(
      jwtServiceMock as unknown as JwtService,
      configServiceMock as unknown as ConfigService,
    );
  });

  // AUTH-EDGE-01 ----------------------------------------------------------------
  it('AUTH-EDGE-01: rejects expired access_token with UNAUTHENTICATED 401', () => {
    jwtServiceMock.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const { context } = buildContext({ authorization: 'Bearer expired.token.here' });

    let caught: AppException | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      caught = e as AppException;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect(caught?.errorCode).toBe('UNAUTHENTICATED');
    expect(caught?.getStatus()).toBe(401);
  });

  // AUTH-EDGE-02 ----------------------------------------------------------------
  it('AUTH-EDGE-02: rejects malformed/invalid-signature token with UNAUTHENTICATED 401', () => {
    jwtServiceMock.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const { context } = buildContext({ authorization: 'Bearer not-a-real-jwt' });

    expect(() => guard.canActivate(context)).toThrow(AppException);
    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ errorCode: 'UNAUTHENTICATED' }),
    );
  });

  // AUTH-EDGE-03 ----------------------------------------------------------------
  it('AUTH-EDGE-03: rejects header without "Bearer " prefix with UNAUTHENTICATED 401', () => {
    const { context } = buildContext({ authorization: 'Basic abc123' });

    expect(() => guard.canActivate(context)).toThrow(AppException);
    expect(jwtServiceMock.verify).not.toHaveBeenCalled();
  });

  it('rejects when Authorization header is missing entirely', () => {
    const { context } = buildContext({});

    expect(() => guard.canActivate(context)).toThrow(AppException);
    expect(jwtServiceMock.verify).not.toHaveBeenCalled();
  });

  it('attaches user_id to the request and returns true on a valid token', () => {
    jwtServiceMock.verify.mockReturnValue({ sub: 'user-123' });
    const { context, request } = buildContext({
      authorization: 'Bearer valid.token.here',
    });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user_id).toBe('user-123');
  });
});
