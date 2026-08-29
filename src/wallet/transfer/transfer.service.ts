import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { TransferDto } from './dto/transfer.dto';
import {
  PROCESS_TRANSFER_JOB,
  TRANSFER_QUEUE,
  transferJobOptions,
} from './transfer-queue.constants';

export interface TransferResult {
  transfer_id: string;
  status: 'SUCCESS' | 'FAILED';
  amount: number;
  remarks: string | null;
  balance_before: number;
  balance_after: number;
  created_date: string;
}

interface LockedSenderRow {
  id: string;
  balance: bigint;
  phoneNumber: string;
}

interface TransferRecord {
  id: string;
  recipientId: string;
  amount: bigint;
  remarks: string | null;
  status: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
  createdAt: Date;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRANSFER_QUEUE) private readonly transferQueue: Queue,
  ) {}

  async transfer(
    userId: string,
    dto: TransferDto,
    idempotencyKey: string,
  ): Promise<TransferResult> {
    const existing = await this.prisma.transfer.findUnique({
      where: { senderId_idempotencyKey: { senderId: userId, idempotencyKey } },
    });
    if (existing) {
      return this.reconcileWithExisting(existing, dto);
    }

    let transfer: TransferRecord;
    try {
      transfer = await this.prisma.$transaction(async (tx) => {
        // Row lock (CLAUDE.md: every balance mutation happens inside
        // SELECT ... FOR UPDATE) — also carries phone_number so the
        // self-transfer check below needs no separate query.
        const [sender] = await tx.$queryRaw<LockedSenderRow[]>`
          SELECT id, balance, phone_number AS "phoneNumber" FROM users WHERE id = ${userId} FOR UPDATE
        `;

        if (dto.target_phone_number === sender.phoneNumber) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SELF_TRANSFER_NOT_ALLOWED',
            'Cannot transfer to yourself',
          );
        }

        const recipient = await tx.user.findUnique({
          where: { phoneNumber: dto.target_phone_number },
          select: { id: true },
        });
        if (!recipient) {
          throw new AppException(
            HttpStatus.NOT_FOUND,
            'RECIPIENT_NOT_FOUND',
            'Recipient phone number not registered',
          );
        }

        if (sender.balance < BigInt(dto.amount)) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'INSUFFICIENT_BALANCE',
            'Balance is not enough',
          );
        }

        const balanceBefore = sender.balance;
        const balanceAfter = balanceBefore - BigInt(dto.amount);

        await tx.user.update({
          where: { id: userId },
          data: { balance: balanceAfter },
        });

        const created = await tx.transfer.create({
          data: {
            senderId: userId,
            recipientId: recipient.id,
            amount: BigInt(dto.amount),
            remarks: dto.remarks,
            status: 'PENDING',
            balanceBefore,
            balanceAfter,
            idempotencyKey,
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            transactionType: 'TRANSFER',
            direction: 'DEBIT',
            referenceId: created.id,
            amount: BigInt(dto.amount),
            balanceBefore,
            balanceAfter,
            status: 'SUCCESS',
          },
        });

        return created;
      });
    } catch (err: unknown) {
      // Same race as payment.service (RC-03): two concurrent requests with
      // the same Idempotency-Key can both pass the findUnique pre-check —
      // the unique constraint on (senderId, idempotencyKey) decides the winner.
      if (isUniqueConstraintViolation(err)) {
        const winner = await this.prisma.transfer.findUnique({
          where: { senderId_idempotencyKey: { senderId: userId, idempotencyKey } },
        });
        if (winner) return this.reconcileWithExisting(winner, dto);
      }
      throw err;
    }

    // Enqueue AFTER commit (SYSTEM_DESIGN 6.3): the transfer is already
    // PENDING in the DB by this point. If enqueue itself fails (e.g. Redis
    // briefly down), it's not fatal — the reconciliation sweep (every 5 min)
    // will find and re-enqueue this PENDING row.
    try {
      await this.transferQueue.add(
        PROCESS_TRANSFER_JOB,
        { transferId: transfer.id },
        transferJobOptions(),
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue transfer ${transfer.id}`, err as Error);
    }

    return this.toResult(transfer);
  }

  private async reconcileWithExisting(
    existing: TransferRecord,
    dto: TransferDto,
  ): Promise<TransferResult> {
    const recipient = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.target_phone_number },
      select: { id: true },
    });

    const samePayload =
      existing.amount === BigInt(dto.amount) &&
      (existing.remarks ?? null) === (dto.remarks ?? null) &&
      existing.recipientId === recipient?.id;

    if (!samePayload) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'DUPLICATE_IDEMPOTENCY_KEY',
        'Idempotency key already used with a different payload',
      );
    }

    return this.toResult(existing);
  }

  private toResult(transfer: TransferRecord): TransferResult {
    return {
      transfer_id: transfer.id,
      // SRS 3.8: "SUCCESS" here means the sender's debit is final, not that
      // the recipient has been credited yet — that happens async in the
      // worker. FAILED is the one internal status that must surface, since
      // it means the sender was refunded (FR-11) and the transfer is over.
      status: transfer.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      amount: Number(transfer.amount),
      remarks: transfer.remarks,
      balance_before: Number(transfer.balanceBefore),
      balance_after: Number(transfer.balanceAfter),
      created_date: transfer.createdAt.toISOString(),
    };
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}
