import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

export interface TransactionResult {
  transaction_id: string;
  transaction_type: string;
  direction: string;
  status: string;
  amount: number;
  remarks: string | null;
  balance_before: number;
  balance_after: number;
  created_date: string;
}

export interface ListTransactionsResult {
  data: TransactionResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

interface TransactionRow {
  id: string;
  transactionType: string;
  direction: string;
  referenceId: string;
  amount: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  status: string;
  createdAt: Date;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // LIST TRANSACTIONS (SRS 3.9) — paginated, newest first, scoped to userId
  // ---------------------------------------------------------------------------
  async list(userId: string, dto: ListTransactionsDto): Promise<ListTransactionsResult> {
    const page = dto.page ?? DEFAULT_PAGE;
    const limit = dto.limit ?? DEFAULT_LIMIT;

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);

    // The ledger table has no `remarks` column of its own (SRS 7.2) — it's
    // sourced from the originating payment/transfer row via referenceId.
    // Top-ups never carry remarks, so only these two types need a lookup.
    const remarksByReferenceId = await this.fetchRemarks(rows);

    return {
      data: rows.map((row) =>
        this.toResult(row, remarksByReferenceId.get(row.referenceId) ?? null),
      ),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async fetchRemarks(rows: TransactionRow[]): Promise<Map<string, string | null>> {
    const paymentIds = rows
      .filter((row) => row.transactionType === 'PAYMENT')
      .map((row) => row.referenceId);
    const transferIds = rows
      .filter((row) => row.transactionType === 'TRANSFER')
      .map((row) => row.referenceId);

    const [payments, transfers] = await Promise.all([
      paymentIds.length
        ? this.prisma.payment.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, remarks: true },
          })
        : Promise.resolve([]),
      transferIds.length
        ? this.prisma.transfer.findMany({
            where: { id: { in: transferIds } },
            select: { id: true, remarks: true },
          })
        : Promise.resolve([]),
    ]);

    const remarksByReferenceId = new Map<string, string | null>();
    for (const payment of payments) remarksByReferenceId.set(payment.id, payment.remarks);
    for (const transfer of transfers) remarksByReferenceId.set(transfer.id, transfer.remarks);
    return remarksByReferenceId;
  }

  private toResult(row: TransactionRow, remarks: string | null): TransactionResult {
    return {
      transaction_id: row.id,
      transaction_type: row.transactionType,
      direction: row.direction,
      status: row.status,
      amount: Number(row.amount),
      remarks,
      balance_before: Number(row.balanceBefore),
      balance_after: Number(row.balanceAfter),
      created_date: row.createdAt.toISOString(),
    };
  }
}
