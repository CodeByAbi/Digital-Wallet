import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import basicAuth from 'express-basic-auth';
import { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { TRANSFER_QUEUE } from './wallet/transfer/transfer-queue.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global API prefix per SRS base URL: /api/v1
  app.setGlobalPrefix('api/v1');

  // ValidationPipe: strip unknown fields, auto-transform primitive types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strip fields not in DTO
      forbidNonWhitelisted: false, // silently strip extras (not error)
      transform: true,       // auto-cast primitives
    }),
  );

  // Global exception filter — converts all errors to SRS 1.3 FAILED envelope
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response interceptor — wraps 2xx in SRS 1.3 SUCCESS envelope
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Bull Board (SYSTEM_DESIGN 6.7) — mounted outside /api/v1, behind basic
  // auth. It renders job payloads (transfer_id and friends), so it must
  // never be reachable unauthenticated.
  const transferQueue = app.get<Queue>(getQueueToken(TRANSFER_QUEUE));
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(transferQueue)],
    serverAdapter,
  });
  app.use(
    '/admin/queues',
    basicAuth({
      users: {
        [process.env.BULL_BOARD_USER ?? 'admin']:
          process.env.BULL_BOARD_PASSWORD ?? 'admin',
      },
      challenge: true,
    }),
    serverAdapter.getRouter(),
  );

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
