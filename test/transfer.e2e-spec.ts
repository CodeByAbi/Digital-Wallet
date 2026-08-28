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
 * Transfer E2E Tests — uses the test DB + test Redis (docker-compose.test.yml,
 * ports 5433/6380). Environment pre-loaded by test/setup-env.ts (jest globalSetup).
 * The TransferProcessor runs in-process (SYSTEM_DESIGN 6.6), so recipient
 * credit is genuinely async here — tests poll for it instead of asserting
 * inline.
 */
describe('Transfer E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const uniqueSuffix = () => String(Math.floor(Math.random() * 900000) + 100000);

  // Distinct phone prefixes (0816 sender / 0817 recipient) from other e2e
  // spec files (0812-0815) — Jest runs e2e spec files in parallel workers
  // against the same shared test DB.
  const registerAndLogin = async (
    prefix: string,
    initialTopUp = 0,
  ): Promise<{ phone: string; accessToken: string }> => {
    const phone = `${prefix}${uniqueSuffix()}`;
    const pin = '112233';

    await request(app.getHttpServer())
      .post('/api/v1/register')
      .send({
        first_name: 'Transfer',
        last_name: 'Tester',
        phone_number: phone,
        address: 'Jl. Transfer No. 1',
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

  const waitFor = async (
    check: () => Promise<boolean>,
    timeoutMs = 8000,
    intervalMs = 100,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('waitFor timed out');
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
    await prisma.transaction.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0816' } } },
    });
    await prisma.transaction.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0817' } } },
    });
    await prisma.transfer.deleteMany({
      where: { sender: { phoneNumber: { startsWith: '0816' } } },
    });
    await prisma.topUp.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0816' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0816' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { phoneNumber: { startsWith: '0817' } } },
    });
    await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: '0816' } } });
    await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: '0817' } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // E2E-TRF-01: saldo cukup, recipient valid → 201, saldo sender berkurang
  // instan; recipient dikredit async oleh worker
  // ---------------------------------------------------------------------------
  it('E2E-TRF-01: saldo cukup → 201 instan, recipient dikredit async', async () => {
    const sender = await registerAndLogin('0816', 500000);
    const recipient = await registerAndLogin('0817');

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        target_phone_number: recipient.phone,
        amount: 100000,
        remarks: 'Hadiah Ultah',
      })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.result.status).toBe('SUCCESS');
    expect(res.body.result.balance_before).toBe(500000);
    expect(res.body.result.balance_after).toBe(400000);

    const senderInDb = await prisma.user.findUnique({ where: { phoneNumber: sender.phone } });
    expect(Number(senderInDb?.balance)).toBe(400000);

    await waitFor(async () => {
      const transfer = await prisma.transfer.findUnique({
        where: { id: res.body.result.transfer_id as string },
      });
      return transfer?.status === 'SUCCESS';
    });

    const recipientInDb = await prisma.user.findUnique({
      where: { phoneNumber: recipient.phone },
    });
    expect(Number(recipientInDb?.balance)).toBe(100000);
  });

  // ---------------------------------------------------------------------------
  // E2E-TRF-02: saldo tidak cukup → 422, saldo tidak berubah
  // ---------------------------------------------------------------------------
  it('E2E-TRF-02: saldo tidak cukup → 422 INSUFFICIENT_BALANCE', async () => {
    const sender = await registerAndLogin('0816', 50000);
    const recipient = await registerAndLogin('0817');

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ target_phone_number: recipient.phone, amount: 100000 })
      .expect(422);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const senderInDb = await prisma.user.findUnique({ where: { phoneNumber: sender.phone } });
    expect(Number(senderInDb?.balance)).toBe(50000);
  });

  // ---------------------------------------------------------------------------
  // E2E-TRF-03: target = diri sendiri → 422 SELF_TRANSFER_NOT_ALLOWED
  // ---------------------------------------------------------------------------
  it('E2E-TRF-03: target diri sendiri → 422 SELF_TRANSFER_NOT_ALLOWED', async () => {
    const sender = await registerAndLogin('0816', 500000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ target_phone_number: sender.phone, amount: 10000 })
      .expect(422);

    expect(res.body.error.code).toBe('SELF_TRANSFER_NOT_ALLOWED');
  });

  // ---------------------------------------------------------------------------
  // E2E-TRF-04: target phone_number tidak terdaftar → 404 RECIPIENT_NOT_FOUND
  // ---------------------------------------------------------------------------
  it('E2E-TRF-04: target tidak terdaftar → 404 RECIPIENT_NOT_FOUND', async () => {
    const sender = await registerAndLogin('0816', 500000);

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ target_phone_number: '089999999999', amount: 10000 })
      .expect(404);

    expect(res.body.error.code).toBe('RECIPIENT_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key sama + payload sama diulang → response identik, hanya 1
  // transfer row, saldo sender terpotong sekali
  // ---------------------------------------------------------------------------
  it('key sama + payload sama diulang → response identik, tidak ada transfer baru', async () => {
    const sender = await registerAndLogin('0816', 500000);
    const recipient = await registerAndLogin('0817');
    const idempotencyKey = randomUUID();
    const payload = { target_phone_number: recipient.phone, amount: 100000 };

    const first = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(second.body.result).toEqual(first.body.result);

    const transferCount = await prisma.transfer.count({
      where: { sender: { phoneNumber: sender.phone }, idempotencyKey },
    });
    expect(transferCount).toBe(1);

    const senderInDb = await prisma.user.findUnique({ where: { phoneNumber: sender.phone } });
    expect(Number(senderInDb?.balance)).toBe(400000); // debited exactly once
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key sama + payload beda → 409
  // ---------------------------------------------------------------------------
  it('key sama + payload beda → 409 DUPLICATE_IDEMPOTENCY_KEY', async () => {
    const sender = await registerAndLogin('0816', 500000);
    const recipient = await registerAndLogin('0817');
    const idempotencyKey = randomUUID();

    await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ target_phone_number: recipient.phone, amount: 100000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ target_phone_number: recipient.phone, amount: 200000 })
      .expect(409);

    expect(res.body.error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
  });

  it('missing Idempotency-Key header → 400 VALIDATION_ERROR', async () => {
    const sender = await registerAndLogin('0816', 500000);
    const recipient = await registerAndLogin('0817');

    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .send({ target_phone_number: recipient.phone, amount: 100000 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tanpa token → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transfer')
      .set('Idempotency-Key', randomUUID())
      .send({ target_phone_number: '081799999999', amount: 10000 })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
