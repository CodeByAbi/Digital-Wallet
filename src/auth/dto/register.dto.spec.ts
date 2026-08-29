import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';

const VALID: Record<string, string> = {
  first_name: 'Budi',
  last_name: 'Santoso',
  phone_number: '081234567890',
  address: 'Jl. Test No. 1',
  pin: '123456',
};

// ---------------------------------------------------------------------------
// TDD Section 10 edge case — gap-filled Phase 8: "phone_number format
// internasional (+62...) vs lokal (0811...) — konsisten diterima sesuai
// regex SRS 6." No dedicated dto spec existed before; only exercised via
// E2E happy/duplicate/bad-pin paths.
// ---------------------------------------------------------------------------
describe('RegisterDto', () => {
  describe('phone_number — Indonesian format, local vs international (SRS 6)', () => {
    it.each([
      ['0811234567', 'local 08xx'],
      ['+62811234567', 'international +62 prefix'],
      ['62811234567', 'international 62 prefix (no plus)'],
    ])('accepts %s (%s)', async (phone) => {
      const dto = plainToInstance(RegisterDto, { ...VALID, phone_number: phone });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it.each([
      ['0711234567', 'wrong carrier digit after 0'],
      ['08123', 'too short'],
      ['0812345678901234', 'too long'],
      ['081abcdefgh', 'non-numeric'],
    ])('rejects %s (%s)', async (phone) => {
      const dto = plainToInstance(RegisterDto, { ...VALID, phone_number: phone });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'phone_number')).toBe(true);
    });
  });

  describe('pin', () => {
    it('rejects a pin shorter than 6 digits', async () => {
      const dto = plainToInstance(RegisterDto, { ...VALID, pin: '123' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'pin')).toBe(true);
    });

    it('rejects a pin with non-numeric characters', async () => {
      const dto = plainToInstance(RegisterDto, { ...VALID, pin: 'abcdef' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'pin')).toBe(true);
    });
  });

  it('rejects an empty body', async () => {
    const dto = plainToInstance(RegisterDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a fully valid payload', async () => {
    const dto = plainToInstance(RegisterDto, VALID);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
