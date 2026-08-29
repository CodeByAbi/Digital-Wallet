import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const FAKE_USER_ID = 'bc1c823e-b0fb-4b20-88c0-dff25e283252';

const prismaMock = {
  user: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ---------------------------------------------------------------------------
  describe('getProfile()', () => {
    it('returns the profile shape with balance as a plain number, no pin fields', async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        id: FAKE_USER_ID,
        firstName: 'Budi',
        lastName: 'Santoso',
        phoneNumber: '081234567890',
        address: 'Jl. Testing No. 1',
        balance: BigInt(370000),
        updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      });

      const result = await service.getProfile(FAKE_USER_ID);

      expect(result).toEqual({
        user_id: FAKE_USER_ID,
        first_name: 'Budi',
        last_name: 'Santoso',
        phone_number: '081234567890',
        address: 'Jl. Testing No. 1',
        balance: 370000,
        updated_date: '2026-08-30T00:00:00.000Z',
      });
      expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: FAKE_USER_ID },
        select: expect.objectContaining({ id: true, balance: true }),
      });
      // pin/pin_hash must never be selected or returned
      expect(result).not.toHaveProperty('pin');
      expect(result).not.toHaveProperty('pin_hash');
    });
  });

  // ---------------------------------------------------------------------------
  describe('updateProfile()', () => {
    it('updates only the fields provided, leaving others untouched', async () => {
      prismaMock.user.update.mockResolvedValue({
        id: FAKE_USER_ID,
        firstName: 'Guntur',
        lastName: 'Santoso',
        phoneNumber: '081234567890',
        address: 'Jl. Testing No. 1',
        balance: BigInt(0),
        updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      });

      const result = await service.updateProfile(FAKE_USER_ID, {
        first_name: 'Guntur',
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: FAKE_USER_ID },
        data: { firstName: 'Guntur' },
        select: expect.objectContaining({ id: true, balance: true }),
      });
      expect(result.first_name).toBe('Guntur');
      expect(result.last_name).toBe('Santoso');
    });

    it('updates all three allowed fields when all are provided', async () => {
      prismaMock.user.update.mockResolvedValue({
        id: FAKE_USER_ID,
        firstName: 'Guntur',
        lastName: 'S.',
        phoneNumber: '081234567890',
        address: 'Jl. Baru No. 2',
        balance: BigInt(0),
        updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      });

      await service.updateProfile(FAKE_USER_ID, {
        first_name: 'Guntur',
        last_name: 'S.',
        address: 'Jl. Baru No. 2',
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: FAKE_USER_ID },
        data: {
          firstName: 'Guntur',
          lastName: 'S.',
          address: 'Jl. Baru No. 2',
        },
        select: expect.objectContaining({ id: true, balance: true }),
      });
    });
  });
});
