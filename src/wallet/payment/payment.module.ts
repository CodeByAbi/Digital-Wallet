import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule exports JwtAuthGuard, which needs JwtService/ConfigService
  // resolvable in this module's DI container.
  imports: [AuthModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
