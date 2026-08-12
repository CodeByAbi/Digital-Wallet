import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RejectImmutableProfileFieldsPipe } from './pipes/reject-immutable-profile-fields.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';

/**
 * GET/PATCH /api/v1/profile — both protected by JwtAuthGuard (SRS Section 4).
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

  @Patch()
  async updateProfile(
    @Body(RejectImmutableProfileFieldsPipe) dto: UpdateProfileDto,
    @CurrentUserId() userId: string,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }
}
