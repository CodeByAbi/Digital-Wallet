import { Module } from '@nestjs/common';
import { TopupModule } from './topup/topup.module';
import { PaymentModule } from './payment/payment.module';
import { TransferModule } from './transfer/transfer.module';

@Module({
  imports: [TopupModule, PaymentModule, TransferModule],
})
export class WalletModule {}
