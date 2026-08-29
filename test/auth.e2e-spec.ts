import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Auth E2E Tests — uses the test DB (docker-compose.test.yml, port 5433).
 * Environment is pre-loaded by test/setup-env.ts (jest globalSetup).
 *
 * IMPORTANT: run `docker compose -f docker-compose.test.yml up -d` and
 * `DATABASE_URL=postgresql://wallet:wallet@localhost:5433/wallet_db_test npx prisma migrate deploy`
 * before executing these tests.
 */
describe('Auth E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Use a unique phone_number prefix to avoid collisions between test runs
  const uniqueSuffix = () =>
    String(Math.floor(Math.random() * 900000) + 100000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up test data created during this run
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0812' } } },
    });
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0812' } },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // E2E-REG-01: register new phone_number → 201, no pin in response
  // ---------------------------------------------------------------------------
  it('E2E-REG-01: register new phone_number → 201, result has no pin field', async () => {
    const phone = `0812${uniqueSuffix()}`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Budi',
        last_name: 'Santoso',
        phone_number: phone,
        address: 'Jl. Test No. 1',
        pin: '123456',
      })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result).toBeDefined();
    expect(res.body.result.user_id).toBeDefined();
    expect(res.body.result.phone_number).toBe(phone);
    // PIN must NEVER appear in response
    expect(res.body.result.pin).toBeUndefined();
    expect(res.body.result.pin_hash).toBeUndefined();
    expect(res.body.result.created_date).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // E2E-REG-02: duplicate phone_number → 409
  // ---------------------------------------------------------------------------
  it('E2E-REG-02: duplicate phone_number → 409 PHONE_NUMBER_ALREADY_REGISTERED', async () => {
    const phone = `0812${uniqueSuffix()}`;
    const payload = {
      first_name: 'Ani',
      last_name: 'Wahyu',
      phone_number: phone,
      address: 'Jl. Duplikat No. 2',
      pin: '654321',
    };

    // First registration — should succeed
    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send(payload)
      .expect(201);

    // Second registration with same phone — should fail
    const res = await request(app.getHttpServer())
      .post('/api/v1/register')
      .send(payload)
      .expect(409);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('PHONE_NUMBER_ALREADY_REGISTERED');
    expect(res.body.error.message).toBe('Phone Number already registered');
  });

  // ---------------------------------------------------------------------------
  // E2E-REG-03: pin not 6 digits → 400 VALIDATION_ERROR
  // ---------------------------------------------------------------------------
  it('E2E-REG-03: pin not 6 digits → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Siti',
        last_name: 'Rahayu',
        phone_number: `0812${uniqueSuffix()}`,
        address: 'Jl. Salah Pin',
        pin: '123', // not 6 digits
      })
      .expect(400);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // ---------------------------------------------------------------------------
  // E2E-LOGIN-01: valid credentials → 200, both tokens present
  // ---------------------------------------------------------------------------
  it('E2E-LOGIN-01: valid credentials → 200, access_token + refresh_token present', async () => {
    const phone = `0812${uniqueSuffix()}`;

    // Register first
    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Joko',
        last_name: 'Widodo',
        phone_number: phone,
        address: 'Jl. Merdeka No. 1',
        pin: '987654',
      })
      .expect(201);

    // Now login
    const res = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin: '987654' })
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.access_token).toBeDefined();
    expect(res.body.result.refresh_token).toBeDefined();
    expect(res.body.result.expires_in).toBe(900);
    // Tokens should be non-empty strings
    expect(typeof res.body.result.access_token).toBe('string');
    expect(res.body.result.access_token.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // E2E-LOGIN-02: wrong pin → 401 INVALID_CREDENTIALS
  // ---------------------------------------------------------------------------
  it('E2E-LOGIN-02: wrong pin → 401 INVALID_CREDENTIALS', async () => {
    const phone = `0812${uniqueSuffix()}`;

    // Register first
    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Mega',
        last_name: 'Wati',
        phone_number: phone,
        address: 'Jl. Proklamasi No. 1',
        pin: '111111',
      })
      .expect(201);

    // Login with wrong pin
    const res = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin: '999999' })
      .expect(401);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe("Phone number and pin doesn't match");
  });

  // ---------------------------------------------------------------------------
  // E2E-LOGIN-03: 5 consecutive wrong pins → 6th attempt (even correct) → 429
  // ---------------------------------------------------------------------------
  it('E2E-LOGIN-03: pin salah 5x berturut-turut, percobaan ke-6 → 429 ACCOUNT_LOCKED', async () => {
    const phone = `0812${uniqueSuffix()}`;
    const correctPin = '135790';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Kunto',
        last_name: 'Aji',
        phone_number: phone,
        address: 'Jl. Lockout No. 1',
        pin: correctPin,
      })
      .expect(201);

    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/login')
        .send({ phone_number: phone, pin: '000000' })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    // 6th attempt uses the CORRECT pin — must still be rejected as locked
    const res = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin: correctPin })
      .expect(429);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(res.body.error.message).toBe(
      'Too many failed attempts, try again in 15 minutes',
    );
  });

  // ---------------------------------------------------------------------------
  // POST /refresh-token
  // ---------------------------------------------------------------------------
  describe('POST /refresh-token', () => {
    it('E2E-REFRESH-01: refresh_token valid → 200, access_token baru', async () => {
      const phone = `0812${uniqueSuffix()}`;

      await request(app.getHttpServer())
        .post('/api/v1/register')
        .send({
          first_name: 'Rina',
          last_name: 'Marlina',
          phone_number: phone,
          address: 'Jl. Refresh No. 1',
          pin: '246810',
        })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/login')
        .send({ phone_number: phone, pin: '246810' })
        .expect(200);

      const { refresh_token } = loginRes.body.result as {
        access_token: string;
        refresh_token: string;
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/refresh-token')
        .send({ refresh_token })
        .expect(200);

      expect(res.body.status).toBe('SUCCESS');
      expect(typeof res.body.result.access_token).toBe('string');
      expect(res.body.result.access_token.length).toBeGreaterThan(0);
      expect(res.body.result.expires_in).toBe(900);
      // No new refresh_token is minted (token rotation is out of MVP scope)
      expect(res.body.result.refresh_token).toBeUndefined();
    });

    it('E2E-REFRESH-02a: revoked refresh_token → 401 INVALID_REFRESH_TOKEN', async () => {
      const phone = `0812${uniqueSuffix()}`;

      await request(app.getHttpServer())
        .post('/api/v1/register')
        .send({
          first_name: 'Doni',
          last_name: 'Saputra',
          phone_number: phone,
          address: 'Jl. Revoked No. 1',
          pin: '112233',
        })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/login')
        .send({ phone_number: phone, pin: '112233' })
        .expect(200);

      const { refresh_token } = loginRes.body.result as {
        refresh_token: string;
      };

      // Revoke every refresh token for this user directly at the DB level
      // (no logout endpoint exists yet to do this through the API).
      const user = await prisma.user.findUnique({
        where: { phoneNumber: phone },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: user!.id },
        data: { revoked: true },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/refresh-token')
        .send({ refresh_token })
        .expect(401);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
      expect(res.body.error.message).toBe(
        'Refresh token is invalid or expired',
      );
    });

    it('E2E-REFRESH-02b: expired refresh_token → 401 INVALID_REFRESH_TOKEN', async () => {
      const jwtService = app.get(JwtService);
      const expiredToken = jwtService.sign(
        { sub: 'nonexistent-user-id' },
        { secret: process.env.JWT_SECRET, expiresIn: '0s' },
      );

      // Give the token a moment to cross its own expiry boundary
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const res = await request(app.getHttpServer())
        .post('/api/v1/refresh-token')
        .send({ refresh_token: expiredToken })
        .expect(401);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('malformed refresh_token → 401 INVALID_REFRESH_TOKEN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/refresh-token')
        .send({ refresh_token: 'not-a-real-jwt' })
        .expect(401);

      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
