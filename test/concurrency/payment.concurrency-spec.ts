import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * RC-01 (TDD Section 7) — two /payment requests fired truly concurrently
 * (Promise.all, not sequential) against the SAME sender, where the balance
 * covers exactly one of the two. The row lock (`SELECT ... FOR UPDATE` in
 * PaymentService) must serialize them so exactly one wins — never both
 * succeeding (overdraft) and never both failing.
 *
 * Requires the real test Postgres (docker-compose.test.yml) — mocks can't
 * reproduce row-lock contention. Run via `npm run test:concurrency`.
 */
describe('RC-01: concurrent /payment from the same sender', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () =>
    String(Math.floor(Math.random() * 900000) + 100000);

  const registerAndLogin = async (
    initialTopUp: number,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `0818${uniqueSuffix()}`;
    const pin = '135790';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'RC01',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Concurrency No. 1',
        pin,
      })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin })
      .expect(200);

    const accessToken = (loginRes.body.result as { access_token: string })
      .access_token;

    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: initialTopUp })
      .expect(201);

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
      where: { user: { phoneNumber: { startsWith: '0818' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0818' } } },
    });
    await prisma.topUp.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0818' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0818' } } },
    });
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0818' } },
    });
    await app.close();
  });

  it('exactly one of two simultaneous payments succeeds; final balance reflects only the winner', async () => {
    // Balance covers exactly one 100,000 payment, not both.
    const { phone, accessToken } = await registerAndLogin(150000);

    const fire = () =>
      request(app.getHttpServer())
        .post('/api/v1/pay')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 100000 });

    const [resA, resB] = await Promise.all([fire(), fire()]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 422]);

    const failed = resA.status === 422 ? resA : resB;
    expect(failed.body.error.code).toBe('INSUFFICIENT_BALANCE');

    // The load-bearing assertion: check the ACTUAL balance in the DB, not
    // just the HTTP responses — a race at the application layer could still
    // leave the row inconsistent even if both responses "look" correct.
    const userInDb = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    expect(Number(userInDb?.balance)).toBe(50000);

    const paymentCount = await prisma.payment.count({
      where: { user: { phoneNumber: phone } },
    });
    expect(paymentCount).toBe(1);
  });
});
