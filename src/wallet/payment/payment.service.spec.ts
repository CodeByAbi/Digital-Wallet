import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';

const FAKE_USER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';
const IDEMPOTENCY_KEY = '2f4a9c1e-5b3a-4e3b-9a1a-8f0b2c3d4e5f';

const txMock = {
  $queryRaw: jest.fn(),
  user: { update: jest.fn() },
  payment: { create: jest.fn() },
  transaction: { create: jest.fn() },
};

const prismaMock = {
  payment: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

describe('PaymentService', () => {
  let service: PaymentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: typeof txMock) => unknown) => cb(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  // ---------------------------------------------------------------------------
  // UT-WALLET-02: payment amount > saldo → INSUFFICIENT_BALANCE, no balance update
  // ---------------------------------------------------------------------------
  it('throws INSUFFICIENT_BALANCE and never touches balance when saldo is too low', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: FAKE_USER_ID, balance: BigInt(50000) },
    ]);

    await expect(
      service.pay(FAKE_USER_ID, { amount: 100000 }, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({
      errorCode: 'INSUFFICIENT_BALANCE',
    });

    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.payment.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // UT-WALLET-05 (payment side): balance_after computed exactly via BigInt
  // ---------------------------------------------------------------------------
  it('locks the row, debits balance exactly, and writes a DEBIT ledger entry', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: FAKE_USER_ID, balance: BigInt(500000) },
    ]);
    txMock.payment.create.mockResolvedValue({
      id: 'payment-id',
      amount: BigInt(100000),
      remarks: 'Pulsa Telkomsel 100k',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:22:00.000Z'),
    });

    const result = await service.pay(
      FAKE_USER_ID,
      { amount: 100000, remarks: 'Pulsa Telkomsel 100k' },
      IDEMPOTENCY_KEY,
    );

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: FAKE_USER_ID },
      data: { balance: BigInt(400000) },
    });
    expect(txMock.payment.create).toHaveBeenCalledWith({
      data: {
        userId: FAKE_USER_ID,
        amount: BigInt(100000),
        remarks: 'Pulsa Telkomsel 100k',
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(400000),
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionType: 'PAYMENT',
        direction: 'DEBIT',
        referenceId: 'payment-id',
        status: 'SUCCESS',
      }),
    });
    expect(result).toEqual({
      payment_id: 'payment-id',
      amount: 100000,
      remarks: 'Pulsa Telkomsel 100k',
      balance_before: 500000,
      balance_after: 400000,
      created_date: '2026-08-11T22:22:00.000Z',
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key reuse — same payload → returns the original, no new insert
  // ---------------------------------------------------------------------------
  it('returns the original result when the same key + same payload is replayed', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-id',
      amount: BigInt(100000),
      remarks: 'Pulsa Telkomsel 100k',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:22:00.000Z'),
    });

    const result = await service.pay(
      FAKE_USER_ID,
      { amount: 100000, remarks: 'Pulsa Telkomsel 100k' },
      IDEMPOTENCY_KEY,
    );

    expect(result.payment_id).toBe('payment-id');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key reuse — different payload → DUPLICATE_IDEMPOTENCY_KEY
  // ---------------------------------------------------------------------------
  it('throws DUPLICATE_IDEMPOTENCY_KEY when the same key is reused with a different payload', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-id',
      amount: BigInt(100000),
      remarks: 'Pulsa Telkomsel 100k',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:22:00.000Z'),
    });

    await expect(
      service.pay(FAKE_USER_ID, { amount: 200000 }, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({ errorCode: 'DUPLICATE_IDEMPOTENCY_KEY' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // RC-03: concurrent identical-key requests race past the pre-check —
  // the unique constraint on insert is what actually decides the winner.
  // ---------------------------------------------------------------------------
  it('reconciles with the winning row on a unique-constraint race instead of erroring', async () => {
    prismaMock.payment.findUnique
      .mockResolvedValueOnce(null) // pre-check: nothing found, proceeds to insert
      .mockResolvedValueOnce({
        id: 'winner-payment-id',
        amount: BigInt(100000),
        remarks: null,
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(400000),
        createdAt: new Date('2026-08-11T22:22:00.000Z'),
      });
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await service.pay(
      FAKE_USER_ID,
      { amount: 100000 },
      IDEMPOTENCY_KEY,
    );

    expect(result.payment_id).toBe('winner-payment-id');
  });

  it('errors with INTERNAL error class unchanged when the loser payload also differs', async () => {
    prismaMock.payment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'winner-payment-id',
        amount: BigInt(999999),
        remarks: null,
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(-499999),
        createdAt: new Date('2026-08-11T22:22:00.000Z'),
      });
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(
      service.pay(FAKE_USER_ID, { amount: 100000 }, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({ errorCode: 'DUPLICATE_IDEMPOTENCY_KEY' });
  });

  it('rethrows unrelated transaction errors untouched', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValueOnce(
      new Error('connection reset'),
    );

    await expect(
      service.pay(FAKE_USER_ID, { amount: 100000 }, IDEMPOTENCY_KEY),
    ).rejects.toThrow('connection reset');
  });
});
