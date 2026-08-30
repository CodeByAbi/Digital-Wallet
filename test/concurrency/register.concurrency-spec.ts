import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * TDD Section 10 edge case — "Concurrent request register dengan
 * phone_number sama persis (mirip RC-03 tapi untuk register)." Two
 * /register requests with the identical phone_number fired truly
 * concurrently: the `phone_number` unique constraint must let exactly one
 * through, never both, never a raw 500 for the loser.
 */
describe('Concurrent /register with the identical phone_number', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
    await prisma.user.deleteMany({
      where: { phoneNumber: { startsWith: '0824' } },
    });
    await app.close();
  });

  it('exactly one registration succeeds; the loser gets 409, not a raw 500', async () => {
    const phone = `0824${uniqueSuffix()}`;
    const payload = {
      first_name: 'Race',
      last_name: 'Register',
      phone_number: phone,
      address: 'Jl. Concurrency No. 4',
      pin: '998877',
    };

    const fire = () =>
      request(app.getHttpServer()).post('/api/v1/register').send(payload);

    const [resA, resB] = await Promise.all([fire(), fire()]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failed = resA.status === 409 ? resA : resB;
    expect(failed.body.error.code).toBe('PHONE_NUMBER_ALREADY_REGISTERED');

    const userCount = await prisma.user.count({
      where: { phoneNumber: phone },
    });
    expect(userCount).toBe(1);
  });
});
