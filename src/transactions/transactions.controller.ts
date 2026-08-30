import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';

/**
 * GET /api/v1/transactions — protected by JwtAuthGuard (SRS Section 3.9).
 */
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  async list(
    @Query() dto: ListTransactionsDto,
    @CurrentUserId() userId: string,
  ) {
    return this.transactionsService.list(userId, dto);
  }
}
