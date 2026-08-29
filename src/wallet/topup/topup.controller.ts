import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TopupService } from './topup.service';
import { TopupDto } from './dto/topup.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../../auth/decorators/current-user-id.decorator';

/**
 * POST /api/v1/topup — protected by JwtAuthGuard (SRS Section 3.6).
 */
@Controller('topup')
@UseGuards(JwtAuthGuard)
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async topup(@Body() dto: TopupDto, @CurrentUserId() userId: string) {
    return this.topupService.topup(userId, dto);
  }
}
