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
 * RC-03 (TDD Section 7) — two requests with the SAME Idempotency-Key fired
 * truly concurrently (Promise.all), not one-after-another. Both requests can
 * race past the `findUnique` pre-check before either commits; the unique
 * constraint on (userId/senderId, idempotency_key) is what actually decides
 * the winner (payment.service.ts / transfer.service.ts catch P2002 and
 * reconcile the loser with the winner's row). This also stands in for
 * IT-DB-02 (TDD Section 4) against a real Postgres constraint instead of a
 * mocked one.
 */
describe('RC-03: concurrent identical-Idempotency-Key requests', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () => String(Math.floor(Math.random() * 900000) + 100000);

  const registerAndLogin = async (
    prefix: string,
    initialTopUp = 0,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `${prefix}${uniqueSuffix()}`;
    const pin = '224466';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'RC03',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Concurrency No. 3',
        pin,
      })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin })
      .expect(200);

    const accessToken = (loginRes.body.result as { access_token: string }).access_token;

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const prefix of ['0821', '0822', '0823']) {
      await prisma.transaction.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
    }
    await prisma.payment.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0821' } } },
    });
    await prisma.transfer.deleteMany({
      where: { sender: { phoneNumber: { startsWith: '0822' } } },
    });
    for (const prefix of ['0821', '0822', '0823']) {
      await prisma.topUp.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
      await prisma.refreshToken.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
      await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: prefix } } });
    }
    await app.close();
  });

  it('/payment: only one row is inserted; both responses match the winner', async () => {
    const { phone, accessToken } = await registerAndLogin('0821', 500000);
    const idempotencyKey = randomUUID();
    const payload = { amount: 100000, remarks: 'RC-03 payment race' };

    const fire = () =>
      request(app.getHttpServer())
        .post('/api/v1/pay')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

    const [resA, resB] = await Promise.all([fire(), fire()]);

    // Both requests must resolve to the SAME winning payment — never two
    // distinct payments, and never one leaked as a raw 500.
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.result.payment_id).toBe(resB.body.result.payment_id);

    const paymentCount = await prisma.payment.count({
      where: { user: { phoneNumber: phone }, idempotencyKey },
    });
    expect(paymentCount).toBe(1);

    const userInDb = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    expect(Number(userInDb?.balance)).toBe(400000); // debited exactly once, not twice
  });

  it('/transfer: only one row is inserted; both responses match the winner', async () => {
    const sender = await registerAndLogin('0822', 500000);
    const recipient = await registerAndLogin('0823');
    const idempotencyKey = randomUUID();
    const payload = { target_phone_number: recipient.phone, amount: 100000 };

    const fire = () =>
      request(app.getHttpServer())
        .post('/api/v1/transfer')
        .set('Authorization', `Bearer ${sender.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

    const [resA, resB] = await Promise.all([fire(), fire()]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.result.transfer_id).toBe(resB.body.result.transfer_id);

    const transferCount = await prisma.transfer.count({
      where: { sender: { phoneNumber: sender.phone }, idempotencyKey },
    });
    expect(transferCount).toBe(1);

    const senderInDb = await prisma.user.findUnique({ where: { phoneNumber: sender.phone } });
    expect(Number(senderInDb?.balance)).toBe(400000); // debited exactly once, not twice
  });
});
