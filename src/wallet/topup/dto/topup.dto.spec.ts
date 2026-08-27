import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TopupDto } from './topup.dto';

// ---------------------------------------------------------------------------
// UT-WALLET-01: top up amount below minimum → VALIDATION_ERROR
// ---------------------------------------------------------------------------
describe('TopupDto', () => {
  it('rejects an amount below the 10,000 minimum', async () => {
    const dto = plainToInstance(TopupDto, { amount: 9999 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('amount');
  });

  it('rejects an amount above the 50,000,000 maximum', async () => {
    const dto = plainToInstance(TopupDto, { amount: 50_000_001 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a string amount instead of silently casting it', async () => {
    const dto = plainToInstance(TopupDto, { amount: '500000' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a decimal amount', async () => {
    const dto = plainToInstance(TopupDto, { amount: 100000.5 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid integer amount within bounds', async () => {
    const dto = plainToInstance(TopupDto, { amount: 500000 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
