import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { PayDto } from './dto/pay.dto';

export interface PaymentResult {
  payment_id: string;
  amount: number;
  remarks: string | null;
  balance_before: number;
  balance_after: number;
  created_date: string;
}

interface LockedUserRow {
  id: string;
  balance: bigint;
}

interface PaymentRecord {
  id: string;
  amount: bigint;
  remarks: string | null;
  balanceBefore: bigint;
  balanceAfter: bigint;
  createdAt: Date;
}

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async pay(
    userId: string,
    dto: PayDto,
    idempotencyKey: string,
  ): Promise<PaymentResult> {
    const existing = await this.prisma.payment.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (existing) {
      return this.reconcileWithExisting(existing, dto);
    }

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        // Row lock (CLAUDE.md: every balance mutation happens inside
        // SELECT ... FOR UPDATE) — taken explicitly since Prisma's
        // findUnique doesn't emit FOR UPDATE on its own.
        const [user] = await tx.$queryRaw<LockedUserRow[]>`
          SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
        `;

        if (user.balance < BigInt(dto.amount)) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'INSUFFICIENT_BALANCE',
            'Balance is not enough',
          );
        }

        const balanceBefore = user.balance;
        const balanceAfter = balanceBefore - BigInt(dto.amount);

        await tx.user.update({
          where: { id: userId },
          data: { balance: balanceAfter },
        });

        const created = await tx.payment.create({
          data: {
            userId,
            amount: BigInt(dto.amount),
            remarks: dto.remarks,
            balanceBefore,
            balanceAfter,
            idempotencyKey,
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            transactionType: 'PAYMENT',
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

      return this.toResult(payment);
    } catch (err: unknown) {
      // Two concurrent requests with the same Idempotency-Key can both pass
      // the findUnique check above before either commits (RC-03) — the
      // unique constraint on (userId, idempotencyKey) is what actually
      // decides the winner. The loser lands here instead of a raw 500.
      if (isUniqueConstraintViolation(err)) {
        const winner = await this.prisma.payment.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (winner) return this.reconcileWithExisting(winner, dto);
      }
      throw err;
    }
  }

  private reconcileWithExisting(
    existing: PaymentRecord,
    dto: PayDto,
  ): PaymentResult {
    const samePayload =
      existing.amount === BigInt(dto.amount) &&
      (existing.remarks ?? null) === (dto.remarks ?? null);

    if (!samePayload) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'DUPLICATE_IDEMPOTENCY_KEY',
        'Idempotency key already used with a different payload',
      );
    }

    return this.toResult(existing);
  }

  private toResult(payment: PaymentRecord): PaymentResult {
    return {
      payment_id: payment.id,
      amount: Number(payment.amount),
      remarks: payment.remarks,
      balance_before: Number(payment.balanceBefore),
      balance_after: Number(payment.balanceAfter),
      created_date: payment.createdAt.toISOString(),
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
