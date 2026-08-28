import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopupDto } from './dto/topup.dto';

export interface TopupResult {
  top_up_id: string;
  amount_top_up: number;
  balance_before: number;
  balance_after: number;
  created_date: string;
}

interface LockedUserRow {
  id: string;
  balance: bigint;
}

@Injectable()
export class TopupService {
  constructor(private readonly prisma: PrismaService) {}

  async topup(userId: string, dto: TopupDto): Promise<TopupResult> {
    const amount = BigInt(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      // Row lock (CLAUDE.md: every balance mutation happens inside
      // SELECT ... FOR UPDATE) — Prisma's findUnique doesn't emit FOR UPDATE,
      // so the lock is taken explicitly via raw SQL within the same tx.
      const [user] = await tx.$queryRaw<LockedUserRow[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `;

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;

      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter },
      });

      const topUp = await tx.topUp.create({
        data: {
          userId,
          amount,
          balanceBefore,
          balanceAfter,
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          transactionType: 'TOP_UP',
          direction: 'CREDIT',
          referenceId: topUp.id,
          amount,
          balanceBefore,
          balanceAfter,
          status: 'SUCCESS',
        },
      });

      return {
        top_up_id: topUp.id,
        amount_top_up: Number(topUp.amount),
        balance_before: Number(balanceBefore),
        balance_after: Number(balanceAfter),
        created_date: topUp.createdAt.toISOString(),
      };
    });
  }
}
