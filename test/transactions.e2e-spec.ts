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
 * Transactions E2E Tests — uses the test DB (docker-compose.test.yml, port
 * 5433). Environment is pre-loaded by test/setup-env.ts (jest globalSetup).
 * Distinct phone prefix (0818/0819) from other e2e spec files (0812-0817) —
 * Jest runs e2e spec files in parallel workers against the same shared test DB.
 */
describe('Transactions E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () => String(Math.floor(Math.random() * 900000) + 100000);

  const registerAndLogin = async (
    prefix: string,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `${prefix}${uniqueSuffix()}`;
    const pin = '135790';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Txn',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Transaksi No. 1',
        pin,
      })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/login')
      .send({ phone_number: phone, pin })
      .expect(200);

    return {
      phone,
      accessToken: (loginRes.body.result as { access_token: string }).access_token,
    };
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
    for (const prefix of ['0818', '0819']) {
      await prisma.transaction.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
      await prisma.transfer.deleteMany({
        where: { sender: { phoneNumber: { startsWith: prefix } } },
      });
      await prisma.payment.deleteMany({
        where: { user: { phoneNumber: { startsWith: prefix } } },
      });
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

  // ---------------------------------------------------------------------------
  // E2E-TXN-01: user has all 3 transaction types → each appears with the
  // correct transaction_type
  // ---------------------------------------------------------------------------
  it('E2E-TXN-01: user with 3 transaction types → all 3 appear with correct transaction_type', async () => {
    const { accessToken } = await registerAndLogin('0818');

    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 500000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/pay')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 50000, remarks: 'Pulsa' })
      .expect(201);

    const recipient = await registerAndLogin('0819');
    await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ target_phone_number: recipient.phone, amount: 30000, remarks: 'Hadiah' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    const types = (res.body.result.data as Array<{ transaction_type: string }>)
      .map((t) => t.transaction_type)
      .sort();
    expect(types).toEqual(['PAYMENT', 'TOP_UP', 'TRANSFER']);
  });

  // ---------------------------------------------------------------------------
  // E2E-TXN-02: pagination page=2&limit=1 → result matches the offset
  // ---------------------------------------------------------------------------
  it('E2E-TXN-02: pagination page=2&limit=1 → result matches offset', async () => {
    const { accessToken } = await registerAndLogin('0818');

    // 3 top-ups, distinct amounts so ordering is unambiguous.
    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 10000 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 20000 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 30000 })
      .expect(201);

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/transactions?page=1&limit=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const page2 = await request(app.getHttpServer())
      .get('/api/v1/transactions?page=2&limit=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(page1.body.result.data).toHaveLength(1);
    expect(page2.body.result.data).toHaveLength(1);
    expect(page1.body.result.data[0].transaction_id).not.toBe(
      page2.body.result.data[0].transaction_id,
    );
    expect(page1.body.result.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 3,
      total_pages: 3,
    });
    expect(page2.body.result.pagination.page).toBe(2);
    // newest first: page 1 is the last top-up made (30000)
    expect(page1.body.result.data[0].amount).toBe(30000);
    expect(page2.body.result.data[0].amount).toBe(20000);
  });

  // ---------------------------------------------------------------------------
  // E2E-TXN-03: User B cannot see User A's transactions — data isolation
  // ---------------------------------------------------------------------------
  it('E2E-TXN-03: User B cannot see User A transactions', async () => {
    const userA = await registerAndLogin('0818');
    const userB = await registerAndLogin('0819');

    await request(app.getHttpServer())
      .post('/api/v1/topup')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ amount: 77000 })
      .expect(201);

    const resB = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    expect(resB.body.result.data).toEqual([]);
    expect(resB.body.result.pagination.total).toBe(0);
  });

  it('default pagination (no query params) → page=1, limit=20', async () => {
    const { accessToken } = await registerAndLogin('0818');

    const res = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.result.pagination.page).toBe(1);
    expect(res.body.result.pagination.limit).toBe(20);
  });

  it('tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
