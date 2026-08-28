import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROCESS_TRANSFER_JOB,
  TRANSFER_QUEUE,
  TransferJobData,
} from './transfer-queue.constants';

interface LockedBalanceRow {
  id: string;
  balance: bigint;
}

/**
 * Consumer (SYSTEM_DESIGN 6.4). Runs as a plain provider in-process by
 * default (Section 6.6) — registered here, not in a separate worker.ts,
 * unless deployed standalone via WorkerModule.
 */
@Injectable()
@Processor(TRANSFER_QUEUE)
export class TransferProcessor extends WorkerHost {
  private readonly logger = new Logger(TransferProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<TransferJobData>): Promise<void> {
    if (job.name !== PROCESS_TRANSFER_JOB) return;

    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.findUnique({
        where: { id: job.data.transferId },
      });
      if (!transfer) return; // orphan job id — nothing to do

      // Idempotency (SYSTEM_DESIGN 6.4) — the only thing preventing
      // double-credit when this job is retried after a crash between
      // COMMIT and BullMQ's ack.
      if (transfer.status !== 'PENDING') return;

      const [recipient] = await tx.$queryRaw<LockedBalanceRow[]>`
        SELECT id, balance FROM users WHERE id = ${transfer.recipientId} FOR UPDATE
      `;

      const balanceBefore = recipient.balance;
      const balanceAfter = balanceBefore + transfer.amount;

      await tx.user.update({
        where: { id: transfer.recipientId },
        data: { balance: balanceAfter },
      });

      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: 'SUCCESS' },
      });

      await tx.transaction.create({
        data: {
          userId: transfer.recipientId,
          transactionType: 'TRANSFER',
          direction: 'CREDIT',
          referenceId: transfer.id,
          amount: transfer.amount,
          balanceBefore,
          balanceAfter,
          status: 'SUCCESS',
        },
      });
    });
  }

  // Refund handler (PRD FR-11 / Assumption #9): only after retries are
  // exhausted, not on every individual attempt failure.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<TransferJobData>): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    await this.refundSender(job.data.transferId);
  }

  private async refundSender(transferId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
      // Already resolved (SUCCESS by a late-arriving success, or FAILED by
      // an earlier refund) — refunding again would double-credit the sender.
      if (!transfer || transfer.status !== 'PENDING') return;

      const [sender] = await tx.$queryRaw<LockedBalanceRow[]>`
        SELECT id, balance FROM users WHERE id = ${transfer.senderId} FOR UPDATE
      `;

      const balanceBefore = sender.balance;
      const balanceAfter = balanceBefore + transfer.amount;

      await tx.user.update({
        where: { id: transfer.senderId },
        data: { balance: balanceAfter },
      });

      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: 'FAILED' },
      });

      await tx.transaction.create({
        data: {
          userId: transfer.senderId,
          transactionType: 'TRANSFER',
          direction: 'CREDIT', // reversal of the original DEBIT leg
          referenceId: transfer.id,
          amount: transfer.amount,
          balanceBefore,
          balanceAfter,
          status: 'SUCCESS',
        },
      });
    });

    this.logger.warn(`Transfer ${transferId} refunded after exhausting retries`);
  }
}
