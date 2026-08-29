import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Payment E2E Tests — uses the test DB (docker-compose.test.yml, port 5433).
 * Environment is pre-loaded by test/setup-env.ts (jest globalSetup).
 */
describe('Payment E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () =>
    String(Math.floor(Math.random() * 900000) + 100000);

  // Distinct phone prefix from other e2e spec files (0812/0813/0814) — Jest
  // runs e2e spec files in parallel workers against the same shared test DB.
  const registerAndLogin = async (
    initialTopUp = 500000,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `0815${uniqueSuffix()}`;
    const pin = '135791';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Pay',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Payment No. 1',
        pin,
      })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin })
      .expect(200);

    const accessToken = (loginRes.body.result as { access_token: string })
      .access_token;

    if (initialTopUp > 0) {
      await request(app.getHttpServer())
        .post('/api/v1/topup')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ amount: initialTopUp })
        .expect(201);
    }

    return { phone, accessToken };
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
      where: { user: { phoneNumber: { startsWith: '0815' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0815' } } },
    });
    await prisma.topUp.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0815' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0815' } } },
    });
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0815' } },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // E2E-PAY-01: saldo cukup → 201, saldo berkurang tepat
  // ---------------------------------------------------------------------------
  it('E2E-PAY-01: saldo cukup → 201, saldo berkurang tepat', async () => {
    const { phone, accessToken } = await registerAndLogin(500000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 100000, remarks: 'Pulsa Telkomsel 100k' })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.balance_before).toBe(500000);
    expect(res.body.result.balance_after).toBe(400000);
    expect(res.body.result.remarks).toBe('Pulsa Telkomsel 100k');

    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(400000);
  });

  // ---------------------------------------------------------------------------
  // E2E-PAY-02: saldo tidak cukup → 422, saldo tidak berubah
  // ---------------------------------------------------------------------------
  it('E2E-PAY-02: saldo tidak cukup → 422, saldo tidak berubah', async () => {
    const { phone, accessToken } = await registerAndLogin(50000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 100000 })
      .expect(422);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(50000);
  });

  // ---------------------------------------------------------------------------
  // E2E-PAY-03: Idempotency-Key sama, payload sama, diulang → response identik
  // ---------------------------------------------------------------------------
  it('E2E-PAY-03: key sama + payload sama diulang → response identik, tidak ada payment baru', async () => {
    const { phone, accessToken } = await registerAndLogin(500000);
    const idempotencyKey = randomUUID();
    const payload = { amount: 100000, remarks: 'Pulsa Telkomsel 100k' };

    const first = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(second.body.result).toEqual(first.body.result);

    const paymentCount = await prisma.payment.count({
      where: { user: { phoneNumber: phone }, idempotencyKey },
    });
    expect(paymentCount).toBe(1);

    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(400000); // debited exactly once
  });

  // ---------------------------------------------------------------------------
  // E2E-PAY-04: Idempotency-Key sama, payload beda → 409
  // ---------------------------------------------------------------------------
  it('E2E-PAY-04: key sama + payload beda → 409 DUPLICATE_IDEMPOTENCY_KEY', async () => {
    const { accessToken } = await registerAndLogin(500000);
    const idempotencyKey = randomUUID();

    await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 100000, remarks: 'Pulsa Telkomsel 100k' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 200000, remarks: 'Beda payload' })
      .expect(409);

    expect(res.body.error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
  });

  // ---------------------------------------------------------------------------
  // TDD Section 10 edge case: amount exactly equals balance → succeeds with
  // balance_after = 0, must not be mistakenly rejected as insufficient.
  // ---------------------------------------------------------------------------
  it('amount pas sama dengan saldo → 201, balance_after = 0', async () => {
    const { phone, accessToken } = await registerAndLogin(100000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 100000 })
      .expect(201);

    expect(res.body.result.balance_after).toBe(0);

    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(0);
  });

  it('missing Idempotency-Key header → 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerAndLogin(500000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 100000 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('malformed (non-UUID) Idempotency-Key header → 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerAndLogin(500000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ amount: 100000 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 100000 })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
