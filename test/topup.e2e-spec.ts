import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Top Up E2E Tests — uses the test DB (docker-compose.test.yml, port 5433).
 * Environment is pre-loaded by test/setup-env.ts (jest globalSetup).
 */
describe('Top Up E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () =>
    String(Math.floor(Math.random() * 900000) + 100000);

  // Distinct phone prefix from other e2e spec files (0812/0813/0815) — Jest
  // runs e2e spec files in parallel workers against the same shared test DB.
  const registerAndLogin = async (): Promise<{
    phone: string;
    accessToken: string;
  }> => {
    const phone = `0814${uniqueSuffix()}`;
    const pin = '246810';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'TopUp',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. TopUp No. 1',
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
    await prisma.transaction.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0814' } } },
    });
    await prisma.topUp.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0814' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0814' } } },
    });
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0814' } },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // E2E-TOPUP-01: valid amount → 201, balance_after = balance_before + amount
  // ---------------------------------------------------------------------------
  it('E2E-TOPUP-01: amount valid → 201, balance_after = balance_before + amount', async () => {
    const { phone, accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 500000 })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.amount_top_up).toBe(500000);
    expect(res.body.result.balance_before).toBe(0);
    expect(res.body.result.balance_after).toBe(500000);
    expect(res.body.result.top_up_id).toBeDefined();

    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(500000);
  });

  // ---------------------------------------------------------------------------
  // E2E-TOPUP-02: amount below minimum → 400
  // ---------------------------------------------------------------------------
  it('E2E-TOPUP-02: amount di bawah minimum → 400', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 5000 })
      .expect(400);

    expect(res.body.status).toBe('FAILED');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('amount above the maximum → 400', async () => {
    const { accessToken } = await registerAndLogin();

    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 60_000_000 })
      .expect(400);
  });

  it('amount sent as a string is rejected, not silently cast', async () => {
    const { accessToken } = await registerAndLogin();

    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: '500000' })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // E2E-TOPUP-03: no token → 401
  // ---------------------------------------------------------------------------
  it('E2E-TOPUP-03: tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/topup')
      .send({ amount: 500000 })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
