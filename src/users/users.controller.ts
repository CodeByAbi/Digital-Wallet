import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RejectImmutableProfileFieldsGuard } from './guards/reject-immutable-profile-fields.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';

/**
 * GET/PUT /api/v1/profile — both protected by JwtAuthGuard (SRS Section 4).
 * user_id always comes from the verified access_token, never from the body.
 */
@Controller('profile')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getProfile(@CurrentUserId() userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Put()
  @UseGuards(RejectImmutableProfileFieldsGuard)
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUserId() userId: string,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }
}
