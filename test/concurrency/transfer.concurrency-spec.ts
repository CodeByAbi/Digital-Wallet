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
 * RC-02 (TDD Section 7) — two /transfer requests fired truly concurrently
 * from the SAME sender, where the balance covers exactly one of the two.
 * Same row-lock guarantee as RC-01, but exercising TransferService's debit
 * step (which also does `SELECT ... FOR UPDATE` before the recipient lookup
 * and balance check).
 */
describe('RC-02: concurrent /transfer from the same sender', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () =>
    String(Math.floor(Math.random() * 900000) + 100000);

  const registerAndLogin = async (
    prefix: string,
    initialTopUp = 0,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `${prefix}${uniqueSuffix()}`;
    const pin = '112233';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'RC02',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Concurrency No. 2',
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
    for (const prefix of ['0819', '0820']) {
      await prisma.transaction.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
    }
    await prisma.transfer.deleteMany({
      where: { sender: { phoneNumber: { startsWith: '0819' } } },
    });
    await prisma.topUp.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0819' } } },
    });
    for (const prefix of ['0819', '0820']) {
      await prisma.refreshToken.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
      await prisma.user.deleteMany({
        where: { phoneNumber: { startsWith: prefix } },
      });
    }
    await app.close();
  });

  it('exactly one of two simultaneous transfers succeeds; final sender balance reflects only the winner', async () => {
    const sender = await registerAndLogin('0819', 150000);
    const recipient = await registerAndLogin('0820');

    const fire = () =>
      request(app.getHttpServer())
        .post('/api/v1/transfer')
        .set('Authorization', `Bearer ${sender.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ target_phone_number: recipient.phone, amount: 100000 });

    const [resA, resB] = await Promise.all([fire(), fire()]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 422]);

    const failed = resA.status === 422 ? resA : resB;
    expect(failed.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const senderInDb = await prisma.user.findUnique({
      where: { phoneNumber: sender.phone },
    });
    expect(Number(senderInDb?.balance)).toBe(50000);

    const transferCount = await prisma.transfer.count({
      where: { sender: { phoneNumber: sender.phone } },
    });
    expect(transferCount).toBe(1);
  });
});
