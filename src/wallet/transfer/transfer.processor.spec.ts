import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { TransferProcessor } from './transfer.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { PROCESS_TRANSFER_JOB, TransferJobData } from './transfer-queue.constants';

const TRANSFER_ID = 'transfer-id';
const SENDER_ID = 'sender-id';
const RECIPIENT_ID = 'recipient-id';

const txMock = {
  transfer: { findUnique: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  user: { update: jest.fn() },
  transaction: { create: jest.fn() },
};

const prismaMock = {
  $transaction: jest.fn() as jest.Mock,
};

function fakeJob(overrides: Partial<Job<TransferJobData>> = {}): Job<TransferJobData> {
  return {
    name: PROCESS_TRANSFER_JOB,
    data: { transferId: TRANSFER_ID },
    attemptsMade: 5,
    opts: { attempts: 5 },
    ...overrides,
  } as Job<TransferJobData>;
}

describe('TransferProcessor', () => {
  let processor: TransferProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransferProcessor, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    processor = module.get<TransferProcessor>(TransferProcessor);
  });

  // ---------------------------------------------------------------------------
  // Q-01: job processed once → recipient credited, status SUCCESS
  // ---------------------------------------------------------------------------
  it('credits the recipient and flips status to SUCCESS', async () => {
    txMock.transfer.findUnique.mockResolvedValue({
      id: TRANSFER_ID,
      recipientId: RECIPIENT_ID,
      amount: BigInt(30000),
      status: 'PENDING',
    });
    txMock.$queryRaw.mockResolvedValue([{ id: RECIPIENT_ID, balance: BigInt(100000) }]);

    await processor.process(fakeJob());

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: { balance: BigInt(130000) },
    });
    expect(txMock.transfer.update).toHaveBeenCalledWith({
      where: { id: TRANSFER_ID },
      data: { status: 'SUCCESS' },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: RECIPIENT_ID,
        transactionType: 'TRANSFER',
        direction: 'CREDIT',
        referenceId: TRANSFER_ID,
        status: 'SUCCESS',
      }),
    });
  });

  // ---------------------------------------------------------------------------
  // Q-02: same job processed twice (simulated retry after crash) — recipient
  // balance must only increase once, thanks to the PENDING idempotency check
  // ---------------------------------------------------------------------------
  it('is a no-op the second time the same transfer is processed', async () => {
    txMock.transfer.findUnique
      .mockResolvedValueOnce({
        id: TRANSFER_ID,
        recipientId: RECIPIENT_ID,
        amount: BigInt(30000),
        status: 'PENDING',
      })
      .mockResolvedValueOnce({
        id: TRANSFER_ID,
        recipientId: RECIPIENT_ID,
        amount: BigInt(30000),
        status: 'SUCCESS', // already processed by the first call
      });
    txMock.$queryRaw.mockResolvedValue([{ id: RECIPIENT_ID, balance: BigInt(100000) }]);

    await processor.process(fakeJob());
    await processor.process(fakeJob());

    expect(txMock.user.update).toHaveBeenCalledTimes(1);
    expect(txMock.transfer.update).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Q-03: retries exhausted → refund handler runs, sender credited back,
  // transfer flips to FAILED
  // ---------------------------------------------------------------------------
  it('refunds the sender once max attempts are exhausted', async () => {
    txMock.transfer.findUnique.mockResolvedValue({
      id: TRANSFER_ID,
      senderId: SENDER_ID,
      recipientId: RECIPIENT_ID,
      amount: BigInt(30000),
      status: 'PENDING',
    });
    txMock.$queryRaw.mockResolvedValue([{ id: SENDER_ID, balance: BigInt(70000) }]);

    await processor.onFailed(fakeJob({ attemptsMade: 5, opts: { attempts: 5 } }));

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: SENDER_ID },
      data: { balance: BigInt(100000) },
    });
    expect(txMock.transfer.update).toHaveBeenCalledWith({
      where: { id: TRANSFER_ID },
      data: { status: 'FAILED' },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: SENDER_ID,
        transactionType: 'TRANSFER',
        direction: 'CREDIT',
        referenceId: TRANSFER_ID,
        status: 'SUCCESS',
      }),
    });
  });

  it('does not refund while retries remain', async () => {
    await processor.onFailed(fakeJob({ attemptsMade: 2, opts: { attempts: 5 } }));

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('does not double-refund a transfer that is no longer PENDING', async () => {
    txMock.transfer.findUnique.mockResolvedValue({
      id: TRANSFER_ID,
      senderId: SENDER_ID,
      recipientId: RECIPIENT_ID,
      amount: BigInt(30000),
      status: 'FAILED', // an earlier failure event already refunded this
    });

    await processor.onFailed(fakeJob({ attemptsMade: 5, opts: { attempts: 5 } }));

    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.transfer.update).not.toHaveBeenCalled();
  });
});
