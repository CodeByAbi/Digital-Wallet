import { Module } from '@nestjs/common';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule exports JwtAuthGuard, which needs JwtService/ConfigService
  // resolvable in this module's DI container.
  imports: [AuthModule],
  controllers: [TopupController],
  providers: [TopupService],
})
export class TopupModule {}
