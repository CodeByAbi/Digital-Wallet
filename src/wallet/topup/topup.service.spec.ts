import { Test, TestingModule } from '@nestjs/testing';
import { TopupService } from './topup.service';
import { PrismaService } from '../../prisma/prisma.service';

const FAKE_USER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';

const txMock = {
  $queryRaw: jest.fn(),
  user: { update: jest.fn() },
  topUp: { create: jest.fn() },
  transaction: { create: jest.fn() },
};

const prismaMock = {
  $transaction: jest.fn(),
};

describe('TopupService', () => {
  let service: TopupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: typeof txMock) => unknown) => cb(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopupService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<TopupService>(TopupService);
  });

  // ---------------------------------------------------------------------------
  // UT-WALLET-05 (topup side): balance_after computed exactly via BigInt
  // ---------------------------------------------------------------------------
  it('locks the user row, credits balance exactly, and writes a CREDIT ledger entry', async () => {
    txMock.$queryRaw.mockResolvedValue([
      { id: FAKE_USER_ID, balance: BigInt(999999999999) },
    ]);
    txMock.topUp.create.mockResolvedValue({
      id: 'top-up-id',
      amount: BigInt(12345678),
      balanceBefore: BigInt(999999999999),
      balanceAfter: BigInt(1000012345677),
      createdAt: new Date('2026-08-11T22:21:21.000Z'),
    });

    const result = await service.topup(FAKE_USER_ID, { amount: 12345678 });

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: FAKE_USER_ID },
      data: { balance: BigInt(1000012345677) },
    });
    expect(txMock.topUp.create).toHaveBeenCalledWith({
      data: {
        userId: FAKE_USER_ID,
        amount: BigInt(12345678),
        balanceBefore: BigInt(999999999999),
        balanceAfter: BigInt(1000012345677),
      },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: FAKE_USER_ID,
        transactionType: 'TOP_UP',
        direction: 'CREDIT',
        referenceId: 'top-up-id',
        status: 'SUCCESS',
      }),
    });
    expect(result).toEqual({
      top_up_id: 'top-up-id',
      amount_top_up: 12345678,
      balance_before: 999999999999,
      balance_after: 1000012345677,
      created_date: '2026-08-11T22:21:21.000Z',
    });
  });
});
