import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';

// ---------------------------------------------------------------------------
// Gap-filled Phase 8 — no dto spec existed before (login was only exercised
// end-to-end via E2E).
// ---------------------------------------------------------------------------
describe('LoginDto', () => {
  it('accepts a valid phone_number + 6-digit pin', async () => {
    const dto = plainToInstance(LoginDto, {
      phone_number: '081234567890',
      pin: '123456',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed phone_number', async () => {
    const dto = plainToInstance(LoginDto, {
      phone_number: 'not-a-phone',
      pin: '123456',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'phone_number')).toBe(true);
  });

  it('rejects a pin that is not exactly 6 digits', async () => {
    const dto = plainToInstance(LoginDto, {
      phone_number: '081234567890',
      pin: '12345',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'pin')).toBe(true);
  });

  it('rejects an empty body', async () => {
    const dto = plainToInstance(LoginDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
