import { Module } from '@nestjs/common';
import { TopupModule } from './topup/topup.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [TopupModule, PaymentModule],
})
export class WalletModule {}
