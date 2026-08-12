import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import * as bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const PLAIN_PIN = '123456';
const FAKE_USER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';

// A pre-hashed pin we control so tests are deterministic where needed
let HASHED_PIN: string;

beforeAll(async () => {
  HASHED_PIN = await bcrypt.hash(PLAIN_PIN, 10);
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const prismaMock = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

const jwtServiceMock = {
  sign: jest.fn(),
};

const configServiceMock = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_SECRET: 'test-secret',
      JWT_ACCESS_EXPIRY: '15m',
      JWT_REFRESH_EXPIRY: '7d',
    };
    return map[key];
  }),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // UT-AUTH-01 ----------------------------------------------------------------
  describe('UT-AUTH-01: register() hashes pin correctly', () => {
    it('should call bcrypt.hash and pin_hash stored differs from plain pin', async () => {
      const createdAt = new Date();
      prismaMock.user.create.mockResolvedValue({
        id: FAKE_USER_ID,
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: '081200000099',
        address: 'Jl. Test',
        createdAt,
      });

      const dto = {
        first_name: 'Test',
        last_name: 'User',
        phone_number: '081200000099',
        address: 'Jl. Test',
        pin: PLAIN_PIN,
      };

      await service.register(dto);

      // Verify prisma.user.create was called with a pinHash that is NOT the plain pin
      const callArg = prismaMock.user.create.mock.calls[0][0] as {
        data: { pinHash: string };
      };
      const storedHash = callArg.data.pinHash;

      expect(storedHash).not.toBe(PLAIN_PIN);
      // And it should be a valid bcrypt hash of the plain pin
      const isValid = await bcrypt.compare(PLAIN_PIN, storedHash);
      expect(isValid).toBe(true);
    });
  });

  // UT-AUTH-02 ----------------------------------------------------------------
  describe('UT-AUTH-02: login() succeeds when pin matches', () => {
    it('should return access_token, refresh_token, expires_in: 900', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});
      jwtServiceMock.sign
        .mockReturnValueOnce('fake-access-token')
        .mockReturnValueOnce('fake-refresh-token');
      prismaMock.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        phone_number: '081200000001',
        pin: PLAIN_PIN,
      });

      expect(result.access_token).toBe('fake-access-token');
      expect(result.refresh_token).toBe('fake-refresh-token');
      expect(result.expires_in).toBe(900);
    });
  });

  // UT-AUTH-03 ----------------------------------------------------------------
  describe('UT-AUTH-03: login() throws INVALID_CREDENTIALS when pin is wrong', () => {
    it('should throw AppException with INVALID_CREDENTIALS code and 401 status', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});

      await expect(
        service.login({
          phone_number: '081200000001',
          pin: '000000', // wrong pin
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_CREDENTIALS',
        errorMessage: "Phone number and pin doesn't match",
      });
    });

    it('should throw AppException with 401 HTTP status', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});

      let caught: AppException | undefined;
      try {
        await service.login({ phone_number: '081200000001', pin: '000000' });
      } catch (e) {
        caught = e as AppException;
      }

      expect(caught).toBeInstanceOf(AppException);
      expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should throw INVALID_CREDENTIALS when user does not exist (no enumeration)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          phone_number: '081299999999',
          pin: PLAIN_PIN,
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_CREDENTIALS',
      });
    });
  });

  // UT-AUTH-04 ----------------------------------------------------------------
  describe('UT-AUTH-04: generated tokens contain user_id payload and correct expiry', () => {
    it('access token is signed with sub=user_id and 15m expiry', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});
      jwtServiceMock.sign.mockReturnValue('any-token');
      prismaMock.refreshToken.create.mockResolvedValue({});

      await service.login({ phone_number: '081200000001', pin: PLAIN_PIN });

      // First call = access token
      const accessCall = jwtServiceMock.sign.mock.calls[0] as [
        { sub: string },
        { secret: string; expiresIn: string },
      ];
      expect(accessCall[0]).toEqual({ sub: FAKE_USER_ID });
      expect(accessCall[1].expiresIn).toBe('15m');

      // Second call = refresh token
      const refreshCall = jwtServiceMock.sign.mock.calls[1] as [
        { sub: string },
        { secret: string; expiresIn: string },
      ];
      expect(refreshCall[0]).toEqual({ sub: FAKE_USER_ID });
      expect(refreshCall[1].expiresIn).toBe('7d');
    });

    it('stored refresh_token hash differs from plaintext token', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});
      jwtServiceMock.sign
        .mockReturnValueOnce('plain-access')
        .mockReturnValueOnce('plain-refresh');
      prismaMock.refreshToken.create.mockResolvedValue({});

      await service.login({ phone_number: '081200000001', pin: PLAIN_PIN });

      const createCall = prismaMock.refreshToken.create.mock.calls[0][0] as {
        data: { tokenHash: string };
      };
      const storedHash = createCall.data.tokenHash;

      expect(storedHash).not.toBe('plain-refresh');
      const isValid = await bcrypt.compare('plain-refresh', storedHash);
      expect(isValid).toBe(true);
    });
  });

  // UT-AUTH-05 ----------------------------------------------------------------
  describe('UT-AUTH-05: failed login attempt counter', () => {
    it('increments failedLoginAttempts on each wrong-pin attempt', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 2,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});

      await expect(
        service.login({ phone_number: '081200000001', pin: '000000' }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_CREDENTIALS' });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: FAKE_USER_ID },
        data: { failedLoginAttempts: 3 },
      });
    });

    it('resets failedLoginAttempts to 0 and clears lockedUntil on successful login', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 3,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});
      jwtServiceMock.sign
        .mockReturnValueOnce('access')
        .mockReturnValueOnce('refresh');
      prismaMock.refreshToken.create.mockResolvedValue({});

      await service.login({ phone_number: '081200000001', pin: PLAIN_PIN });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: FAKE_USER_ID },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  // UT-AUTH-06 ----------------------------------------------------------------
  describe('UT-AUTH-06: 5th failed attempt triggers lockout', () => {
    it('sets lockedUntil ~15 minutes in the future when attempts reach 5', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 4,
        lockedUntil: null,
      });
      prismaMock.user.update.mockResolvedValue({});

      const before = Date.now();
      await expect(
        service.login({ phone_number: '081200000001', pin: '000000' }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_CREDENTIALS' });
      const after = Date.now();

      const updateCall = prismaMock.user.update.mock.calls[0][0] as {
        data: { failedLoginAttempts: number; lockedUntil: Date };
      };
      expect(updateCall.data.failedLoginAttempts).toBe(5);
      expect(updateCall.data.lockedUntil.getTime()).toBeGreaterThanOrEqual(
        before + 15 * 60 * 1000,
      );
      expect(updateCall.data.lockedUntil.getTime()).toBeLessThanOrEqual(
        after + 15 * 60 * 1000,
      );
    });

    it('throws ACCOUNT_LOCKED (429) without checking pin while lockedUntil is in the future', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: FAKE_USER_ID,
        pinHash: HASHED_PIN,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
      });

      let caught: AppException | undefined;
      try {
        // Correct pin — should still be rejected because the account is locked
        await service.login({ phone_number: '081200000001', pin: PLAIN_PIN });
      } catch (e) {
        caught = e as AppException;
      }

      expect(caught).toBeInstanceOf(AppException);
      expect(caught?.errorCode).toBe('ACCOUNT_LOCKED');
      expect(caught?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });
});
