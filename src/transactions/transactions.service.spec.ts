import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';

const FAKE_USER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';

const prismaMock = {
  transaction: { findMany: jest.fn(), count: jest.fn() },
  payment: { findMany: jest.fn() },
  transfer: { findMany: jest.fn() },
};

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.transfer.findMany.mockResolvedValue([]);
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.transaction.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  // ---------------------------------------------------------------------------
  // UT-TXN-01: scoped to the caller's user_id only
  // ---------------------------------------------------------------------------
  it('UT-TXN-01: queries only the calling user_id', async () => {
    await service.list(FAKE_USER_ID, {});

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: FAKE_USER_ID } }),
    );
    expect(prismaMock.transaction.count).toHaveBeenCalledWith({
      where: { userId: FAKE_USER_ID },
    });
  });

  // ---------------------------------------------------------------------------
  // UT-TXN-02: empty query params default to page=1, limit=20
  // ---------------------------------------------------------------------------
  it('UT-TXN-02: defaults to page=1, limit=20 when query params are empty', async () => {
    const result = await service.list(FAKE_USER_ID, {});

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      total_pages: 1,
    });
  });

  it('applies page/limit into skip/take and echoes them back in pagination', async () => {
    prismaMock.transaction.count.mockResolvedValue(45);

    const result = await service.list(FAKE_USER_ID, { page: 3, limit: 10 });

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.pagination).toEqual({
      page: 3,
      limit: 10,
      total: 45,
      total_pages: 5,
    });
  });

  // ---------------------------------------------------------------------------
  // UT-TXN-03: ordered newest first
  // ---------------------------------------------------------------------------
  it('UT-TXN-03: orders by created_at DESC', async () => {
    await service.list(FAKE_USER_ID, {});

    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('resolves remarks from the payment/transfer source row via referenceId, null for top-ups', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        id: 'txn-1',
        transactionType: 'TOP_UP',
        direction: 'CREDIT',
        referenceId: 'topup-1',
        amount: BigInt(500000),
        balanceBefore: BigInt(0),
        balanceAfter: BigInt(500000),
        status: 'SUCCESS',
        createdAt: new Date('2026-08-11T22:00:00.000Z'),
      },
      {
        id: 'txn-2',
        transactionType: 'PAYMENT',
        direction: 'DEBIT',
        referenceId: 'payment-1',
        amount: BigInt(100000),
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(400000),
        status: 'SUCCESS',
        createdAt: new Date('2026-08-11T22:10:00.000Z'),
      },
      {
        id: 'txn-3',
        transactionType: 'TRANSFER',
        direction: 'DEBIT',
        referenceId: 'transfer-1',
        amount: BigInt(30000),
        balanceBefore: BigInt(400000),
        balanceAfter: BigInt(370000),
        status: 'SUCCESS',
        createdAt: new Date('2026-08-11T22:23:20.000Z'),
      },
    ]);
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'payment-1', remarks: 'Pulsa Telkomsel 100k' },
    ]);
    prismaMock.transfer.findMany.mockResolvedValue([
      { id: 'transfer-1', remarks: 'Hadiah Ultah' },
    ]);

    const result = await service.list(FAKE_USER_ID, {});

    expect(result.data).toEqual([
      expect.objectContaining({
        transaction_id: 'txn-1',
        transaction_type: 'TOP_UP',
        remarks: null,
      }),
      expect.objectContaining({
        transaction_id: 'txn-2',
        transaction_type: 'PAYMENT',
        remarks: 'Pulsa Telkomsel 100k',
      }),
      expect.objectContaining({
        transaction_id: 'txn-3',
        transaction_type: 'TRANSFER',
        remarks: 'Hadiah Ultah',
      }),
    ]);
  });
});
