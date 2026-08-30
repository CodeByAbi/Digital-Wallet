import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PayDto } from './pay.dto';

// ---------------------------------------------------------------------------
// TDD Section 10 edge cases — gap-filled Phase 8 (no dto spec existed before,
// only INSUFFICIENT_BALANCE / idempotency paths were unit-tested).
// ---------------------------------------------------------------------------
describe('PayDto', () => {
  it('rejects a negative amount', async () => {
    const dto = plainToInstance(PayDto, { amount: -100000 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('amount');
  });

  it('rejects a zero amount', async () => {
    const dto = plainToInstance(PayDto, { amount: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a decimal amount', async () => {
    const dto = plainToInstance(PayDto, { amount: 100000.5 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a string amount instead of silently casting it', async () => {
    const dto = plainToInstance(PayDto, { amount: '100000' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an amount above the maximum', async () => {
    const dto = plainToInstance(PayDto, { amount: 50_000_001 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid integer amount without remarks', async () => {
    const dto = plainToInstance(PayDto, { amount: 100000 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects remarks longer than 100 characters', async () => {
    const dto = plainToInstance(PayDto, { amount: 100000, remarks: 'x'.repeat(101) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('remarks');
  });
});
