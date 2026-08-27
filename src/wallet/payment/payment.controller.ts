import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PaymentService } from './payment.service';
import { PayDto } from './dto/pay.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../../auth/decorators/current-user-id.decorator';
import { AppException } from '../../common/exceptions/app.exception';

const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * POST /api/v1/pay — protected by JwtAuthGuard (SRS Section 3.7).
 * Idempotency-Key is a required header, not body — validated here before
 * PaymentService ever sees it, so the service can assume a well-formed key.
 */
@Controller('pay')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async pay(
    @Body() dto: PayDto,
    @CurrentUserId() userId: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Idempotency-Key header is required and must be a valid UUID',
      );
    }

    return this.paymentService.pay(userId, dto, idempotencyKey);
  }
}
