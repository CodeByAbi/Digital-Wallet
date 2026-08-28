import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROCESS_TRANSFER_JOB,
  TRANSFER_QUEUE,
  transferJobOptions,
} from './transfer-queue.constants';

// SYSTEM_DESIGN 6.5 — covers the gap where Redis dies between COMMIT and
// transferQueue.add(): the transfer is PENDING in the DB but no job was
// ever enqueued to process it.
const ORPHAN_THRESHOLD_MS = 2 * 60 * 1000;

@Injectable()
export class TransferReconciliationService {
  private readonly logger = new Logger(TransferReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRANSFER_QUEUE) private readonly transferQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    const orphaned = await this.prisma.transfer.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - ORPHAN_THRESHOLD_MS) },
      },
      select: { id: true },
    });

    for (const { id } of orphaned) {
      await this.transferQueue.add(
        PROCESS_TRANSFER_JOB,
        { transferId: id },
        transferJobOptions(),
      );
    }

    if (orphaned.length > 0) {
      this.logger.warn(
        `Reconciliation sweep re-enqueued ${orphaned.length} orphaned transfer(s)`,
      );
    }
  }
}
