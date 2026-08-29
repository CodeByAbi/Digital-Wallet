import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { TransferProcessor } from './transfer.processor';
import { TransferReconciliationService } from './transfer-reconciliation.service';
import { AuthModule } from '../../auth/auth.module';
import { TRANSFER_QUEUE } from './transfer-queue.constants';

@Module({
  // AuthModule exports JwtAuthGuard, which needs JwtService/ConfigService
  // resolvable in this module's DI container.
  imports: [AuthModule, BullModule.registerQueue({ name: TRANSFER_QUEUE })],
  controllers: [TransferController],
  providers: [TransferService, TransferProcessor, TransferReconciliationService],
})
export class TransferModule {}
