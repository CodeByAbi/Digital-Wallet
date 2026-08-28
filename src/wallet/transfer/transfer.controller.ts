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
import { TransferService } from './transfer.service';
import { TransferDto } from './dto/transfer.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../../auth/decorators/current-user-id.decorator';
import { AppException } from '../../common/exceptions/app.exception';

const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * POST /api/v1/transfer — protected by JwtAuthGuard (SRS Section 3.8).
 * Idempotency-Key is a required header, not body — validated here before
 * TransferService ever sees it, same as PaymentController.
 */
@Controller('transfer')
@UseGuards(JwtAuthGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async transfer(
    @Body() dto: TransferDto,
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

    return this.transferService.transfer(userId, dto, idempotencyKey);
  }
}
