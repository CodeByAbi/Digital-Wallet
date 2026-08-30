import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TransferDto } from './transfer.dto';

const VALID_PHONE = '081234567890';

// ---------------------------------------------------------------------------
// TDD Section 10 edge cases — gap-filled Phase 8 (no dto spec existed before).
// ---------------------------------------------------------------------------
describe('TransferDto', () => {
  describe('amount', () => {
    it('rejects a negative amount', async () => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: VALID_PHONE,
        amount: -1,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a zero amount', async () => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: VALID_PHONE,
        amount: 0,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a decimal amount', async () => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: VALID_PHONE,
        amount: 5000.25,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a string amount instead of silently casting it', async () => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: VALID_PHONE,
        amount: '100000',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects an amount above the maximum', async () => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: VALID_PHONE,
        amount: 50_000_001,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });
  });

  describe('target_phone_number — Indonesian format, local vs international (SRS 6)', () => {
    it.each([
      ['0811234567', 'local 08xx'],
      ['+62811234567', 'international +62 prefix'],
      ['62811234567', 'international 62 prefix (no plus)'],
    ])('accepts %s (%s)', async (phone) => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: phone,
        amount: 10000,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it.each([
      ['0711234567', 'wrong carrier digit after 0'],
      ['08123', 'too short'],
      ['0812345678901234', 'too long'],
      ['081abcdefgh', 'non-numeric'],
      ['', 'empty string'],
    ])('rejects %s (%s)', async (phone) => {
      const dto = plainToInstance(TransferDto, {
        target_phone_number: phone,
        amount: 10000,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'target_phone_number')).toBe(
        true,
      );
    });
  });

  it('accepts a valid payload with optional remarks', async () => {
    const dto = plainToInstance(TransferDto, {
      target_phone_number: VALID_PHONE,
      amount: 100000,
      remarks: 'Hadiah Ultah',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
