import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TransferService } from './transfer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TRANSFER_QUEUE, PROCESS_TRANSFER_JOB } from './transfer-queue.constants';

const SENDER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';
const SENDER_PHONE = '081100000001';
const RECIPIENT_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const RECIPIENT_PHONE = '081100000002';
const IDEMPOTENCY_KEY = '2f4a9c1e-5b3a-4e3b-9a1a-8f0b2c3d4e5f';

const txMock = {
  $queryRaw: jest.fn(),
  user: { update: jest.fn(), findUnique: jest.fn() },
  transfer: { create: jest.fn() },
  transaction: { create: jest.fn() },
};

const prismaMock = {
  transfer: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn() as jest.Mock,
};

const queueMock = { add: jest.fn() };

describe('TransferService', () => {
  let service: TransferService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: getQueueToken(TRANSFER_QUEUE), useValue: queueMock },
      ],
    }).compile();

    service = module.get<TransferService>(TransferService);
  });

  // ---------------------------------------------------------------------------
  // UT-WALLET-03: transfer to own phone_number → SELF_TRANSFER_NOT_ALLOWED,
  // before the recipient is ever looked up
  // ---------------------------------------------------------------------------
  it('throws SELF_TRANSFER_NOT_ALLOWED without querying the recipient', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: SENDER_ID, balance: BigInt(500000), phoneNumber: SENDER_PHONE },
    ]);

    await expect(
      service.transfer(
        SENDER_ID,
        { target_phone_number: SENDER_PHONE, amount: 10000 },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ errorCode: 'SELF_TRANSFER_NOT_ALLOWED' });

    expect(txMock.user.findUnique).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.transfer.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // UT-WALLET-04: target phone_number not registered → RECIPIENT_NOT_FOUND
  // ---------------------------------------------------------------------------
  it('throws RECIPIENT_NOT_FOUND when target phone_number is unregistered', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: SENDER_ID, balance: BigInt(500000), phoneNumber: SENDER_PHONE },
    ]);
    txMock.user.findUnique.mockResolvedValue(null);

    await expect(
      service.transfer(
        SENDER_ID,
        { target_phone_number: RECIPIENT_PHONE, amount: 10000 },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ errorCode: 'RECIPIENT_NOT_FOUND' });

    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.transfer.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // saldo tidak cukup → INSUFFICIENT_BALANCE, no balance update
  // ---------------------------------------------------------------------------
  it('throws INSUFFICIENT_BALANCE and never touches balance when saldo is too low', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: SENDER_ID, balance: BigInt(5000), phoneNumber: SENDER_PHONE },
    ]);
    txMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });

    await expect(
      service.transfer(
        SENDER_ID,
        { target_phone_number: RECIPIENT_PHONE, amount: 100000 },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ errorCode: 'INSUFFICIENT_BALANCE' });

    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.transfer.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Happy path: debit sender inside the request tx, insert PENDING transfer +
  // DEBIT ledger row, enqueue the job only after commit
  // ---------------------------------------------------------------------------
  it('debits the sender, inserts a PENDING transfer, and enqueues the job after commit', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: SENDER_ID, balance: BigInt(500000), phoneNumber: SENDER_PHONE },
    ]);
    txMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });
    txMock.transfer.create.mockResolvedValue({
      id: 'transfer-id',
      recipientId: RECIPIENT_ID,
      amount: BigInt(100000),
      remarks: 'Hadiah Ultah',
      status: 'PENDING',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:23:20.000Z'),
    });

    const result = await service.transfer(
      SENDER_ID,
      { target_phone_number: RECIPIENT_PHONE, amount: 100000, remarks: 'Hadiah Ultah' },
      IDEMPOTENCY_KEY,
    );

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: SENDER_ID },
      data: { balance: BigInt(400000) },
    });
    expect(txMock.transfer.create).toHaveBeenCalledWith({
      data: {
        senderId: SENDER_ID,
        recipientId: RECIPIENT_ID,
        amount: BigInt(100000),
        remarks: 'Hadiah Ultah',
        status: 'PENDING',
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(400000),
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: SENDER_ID,
        transactionType: 'TRANSFER',
        direction: 'DEBIT',
        referenceId: 'transfer-id',
        status: 'SUCCESS',
      }),
    });
    expect(queueMock.add).toHaveBeenCalledWith(
      PROCESS_TRANSFER_JOB,
      { transferId: 'transfer-id' },
      expect.objectContaining({ attempts: expect.any(Number) }),
    );
    expect(result).toEqual({
      transfer_id: 'transfer-id',
      status: 'SUCCESS',
      amount: 100000,
      remarks: 'Hadiah Ultah',
      balance_before: 500000,
      balance_after: 400000,
      created_date: '2026-08-11T22:23:20.000Z',
    });
  });

  // ---------------------------------------------------------------------------
  // Enqueue failure (e.g. Redis briefly down) must not fail the request —
  // reconciliation sweep is the safety net (SYSTEM_DESIGN 6.5)
  // ---------------------------------------------------------------------------
  it('still returns SUCCESS to the client when enqueueing the job fails', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([
      { id: SENDER_ID, balance: BigInt(500000), phoneNumber: SENDER_PHONE },
    ]);
    txMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });
    txMock.transfer.create.mockResolvedValue({
      id: 'transfer-id',
      recipientId: RECIPIENT_ID,
      amount: BigInt(100000),
      remarks: null,
      status: 'PENDING',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:23:20.000Z'),
    });
    queueMock.add.mockRejectedValueOnce(new Error('Redis unreachable'));

    const result = await service.transfer(
      SENDER_ID,
      { target_phone_number: RECIPIENT_PHONE, amount: 100000 },
      IDEMPOTENCY_KEY,
    );

    expect(result.transfer_id).toBe('transfer-id');
    expect(result.status).toBe('SUCCESS');
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key reuse — same payload → returns the original, no new tx
  // ---------------------------------------------------------------------------
  it('returns the original result when the same key + same payload is replayed', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue({
      id: 'transfer-id',
      recipientId: RECIPIENT_ID,
      amount: BigInt(100000),
      remarks: null,
      status: 'PENDING',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:23:20.000Z'),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });

    const result = await service.transfer(
      SENDER_ID,
      { target_phone_number: RECIPIENT_PHONE, amount: 100000 },
      IDEMPOTENCY_KEY,
    );

    expect(result.transfer_id).toBe('transfer-id');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key reuse — different payload → 409 DUPLICATE_IDEMPOTENCY_KEY
  // ---------------------------------------------------------------------------
  it('throws DUPLICATE_IDEMPOTENCY_KEY when the same key is reused with a different amount', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue({
      id: 'transfer-id',
      recipientId: RECIPIENT_ID,
      amount: BigInt(100000),
      remarks: null,
      status: 'PENDING',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:23:20.000Z'),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });

    await expect(
      service.transfer(
        SENDER_ID,
        { target_phone_number: RECIPIENT_PHONE, amount: 200000 },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ errorCode: 'DUPLICATE_IDEMPOTENCY_KEY' });
  });

  // ---------------------------------------------------------------------------
  // A replayed request against an already-FAILED (refunded) transfer must
  // surface the real terminal status, not the optimistic "SUCCESS"
  // ---------------------------------------------------------------------------
  it('reports FAILED on replay once the transfer has been refunded', async () => {
    prismaMock.transfer.findUnique.mockResolvedValue({
      id: 'transfer-id',
      recipientId: RECIPIENT_ID,
      amount: BigInt(100000),
      remarks: null,
      status: 'FAILED',
      balanceBefore: BigInt(500000),
      balanceAfter: BigInt(400000),
      createdAt: new Date('2026-08-11T22:23:20.000Z'),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });

    const result = await service.transfer(
      SENDER_ID,
      { target_phone_number: RECIPIENT_PHONE, amount: 100000 },
      IDEMPOTENCY_KEY,
    );

    expect(result.status).toBe('FAILED');
  });

  // ---------------------------------------------------------------------------
  // RC-03: concurrent identical-key requests race past the pre-check — the
  // unique constraint on insert is what actually decides the winner.
  // ---------------------------------------------------------------------------
  it('reconciles with the winning row on a unique-constraint race instead of erroring', async () => {
    prismaMock.transfer.findUnique
      .mockResolvedValueOnce(null) // pre-check: nothing found, proceeds to insert
      .mockResolvedValueOnce({
        id: 'winner-transfer-id',
        recipientId: RECIPIENT_ID,
        amount: BigInt(100000),
        remarks: null,
        status: 'PENDING',
        balanceBefore: BigInt(500000),
        balanceAfter: BigInt(400000),
        createdAt: new Date('2026-08-11T22:23:20.000Z'),
      });
    prismaMock.user.findUnique.mockResolvedValue({ id: RECIPIENT_ID });
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await service.transfer(
      SENDER_ID,
      { target_phone_number: RECIPIENT_PHONE, amount: 100000 },
      IDEMPOTENCY_KEY,
    );

    expect(result.transfer_id).toBe('winner-transfer-id');
  });
});
