import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { TransferProcessor } from './wallet/transfer/transfer.processor';
import { TransferReconciliationService } from './wallet/transfer/transfer-reconciliation.service';
import { TRANSFER_QUEUE } from './wallet/transfer/transfer-queue.constants';

/**
 * Standalone worker (SYSTEM_DESIGN 6.6) — only the queue consumer +
 * reconciliation cron, no HTTP controllers/AuthModule. Optional: by
 * default `npm run start` already runs TransferProcessor in-process
 * (registered in TransferModule via WalletModule). Use this entrypoint
 * only when scaling the worker out to its own process/container.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: TRANSFER_QUEUE }),
  ],
  providers: [TransferProcessor, TransferReconciliationService],
})
export class WorkerModule {}
