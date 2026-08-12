import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Profile E2E Tests — uses the test DB (docker-compose.test.yml, port 5433).
 * Environment is pre-loaded by test/setup-env.ts (jest globalSetup).
 */
describe('Profile E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () => String(Math.floor(Math.random() * 900000) + 100000);

  // Registers + logs in a fresh user, returns { phone, accessToken }
  const registerAndLogin = async (): Promise<{
    phone: string;
    accessToken: string;
  }> => {
    // Distinct prefix from auth.e2e-spec.ts's 0812xxxxxx: Jest runs e2e spec
    // files in parallel workers against the same shared test DB, so a
    // startsWith cleanup sweep in this file's afterAll must not be able to
    // delete rows another spec file is still mid-test with.
    const phone = `0813${uniqueSuffix()}`;
    const pin = '135790';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Profile',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Profile No. 1',
        pin,
      })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin })
      .expect(200);

    return {
      phone,
      accessToken: (loginRes.body.result as { access_token: string })
        .access_token,
    };
  };

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
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0813' } },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // E2E-PROFILE-01: GET /profile without token → 401
  // ---------------------------------------------------------------------------
  it('E2E-PROFILE-01: GET /profile tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/profile')
      .expect(401);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  // ---------------------------------------------------------------------------
  // E2E-PROFILE-02: GET /profile with valid token → 200, no pin field
  // ---------------------------------------------------------------------------
  it('E2E-PROFILE-02: GET /profile dengan token valid → 200 + data benar, no pin', async () => {
    const { phone, accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.phone_number).toBe(phone);
    expect(res.body.result.first_name).toBe('Profile');
    expect(res.body.result.last_name).toBe('Tester');
    expect(res.body.result.address).toBe('Jl. Profile No. 1');
    expect(res.body.result.balance).toBe(0);
    expect(res.body.result.pin).toBeUndefined();
    expect(res.body.result.pin_hash).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // PATCH /profile — success
  // ---------------------------------------------------------------------------
  it('PATCH /profile dengan field valid → 200, profil terupdate', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ first_name: 'Guntur', address: 'Jl. Baru No. 2' })
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.first_name).toBe('Guntur');
    expect(res.body.result.address).toBe('Jl. Baru No. 2');
    // last_name untouched
    expect(res.body.result.last_name).toBe('Tester');
  });

  // ---------------------------------------------------------------------------
  // E2E-PROFILE-03: PATCH /profile with phone_number inserted → 400, DB unchanged
  // ---------------------------------------------------------------------------
  it('E2E-PROFILE-03: PATCH /profile dengan phone_number disisipkan → 400, DB tidak berubah', async () => {
    const { phone, accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ first_name: 'Guntur', phone_number: '089900000000' })
      .expect(400);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('phone_number');

    const userInDb = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    expect(userInDb).not.toBeNull();
    expect(userInDb?.phoneNumber).toBe(phone);
    expect(userInDb?.firstName).toBe('Profile'); // first_name also NOT partially applied
  });

  it('PATCH /profile dengan pin disisipkan (bahkan null) → 400, request gagal total', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ first_name: 'Guntur', pin: null })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('pin');
  });

  // ---------------------------------------------------------------------------
  // E2E-PROFILE-04: PATCH /profile with empty body → 400
  // ---------------------------------------------------------------------------
  it('E2E-PROFILE-04: PATCH /profile dengan body kosong → 400 validation error', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /profile tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .send({ first_name: 'Guntur' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
