import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TransferReconciliationService } from './transfer-reconciliation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TRANSFER_QUEUE, PROCESS_TRANSFER_JOB } from './transfer-queue.constants';

const prismaMock = {
  transfer: { findMany: jest.fn() },
};

const queueMock = { add: jest.fn() };

describe('TransferReconciliationService', () => {
  let service: TransferReconciliationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferReconciliationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: getQueueToken(TRANSFER_QUEUE), useValue: queueMock },
      ],
    }).compile();

    service = module.get<TransferReconciliationService>(TransferReconciliationService);
  });

  // ---------------------------------------------------------------------------
  // Q-04: orphaned PENDING transfers (enqueue never happened) get re-enqueued
  // ---------------------------------------------------------------------------
  it('re-enqueues orphaned PENDING transfers older than the threshold', async () => {
    prismaMock.transfer.findMany.mockResolvedValue([
      { id: 'orphan-1' },
      { id: 'orphan-2' },
    ]);

    await service.sweep();

    expect(prismaMock.transfer.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        createdAt: { lt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(queueMock.add).toHaveBeenCalledWith(
      PROCESS_TRANSFER_JOB,
      { transferId: 'orphan-1' },
      expect.any(Object),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      PROCESS_TRANSFER_JOB,
      { transferId: 'orphan-2' },
      expect.any(Object),
    );
    expect(queueMock.add).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no orphaned transfers', async () => {
    prismaMock.transfer.findMany.mockResolvedValue([]);

    await service.sweep();

    expect(queueMock.add).not.toHaveBeenCalled();
  });
});
