import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface ProfileResult {
  user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  address: string;
  balance: number;
}

interface UserRecord {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  address: string;
  balance: bigint;
}

const PROFILE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  address: true,
  balance: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // GET PROFILE
  // ---------------------------------------------------------------------------
  async getProfile(userId: string): Promise<ProfileResult> {
    // userId always belongs to an existing user — it comes from a JWT that
    // was only ever issued for a row that existed, and there is no
    // delete-account feature that could remove it afterward.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PROFILE_SELECT,
    });

    return this.toProfileResult(user);
  }

  // ---------------------------------------------------------------------------
  // UPDATE PROFILE
  // ---------------------------------------------------------------------------
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResult> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.first_name !== undefined && { firstName: dto.first_name }),
        ...(dto.last_name !== undefined && { lastName: dto.last_name }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
      select: PROFILE_SELECT,
    });

    return this.toProfileResult(user);
  }

  private toProfileResult(user: UserRecord): ProfileResult {
    return {
      user_id: user.id,
      first_name: user.firstName,
      last_name: user.lastName,
      phone_number: user.phoneNumber,
      address: user.address,
      balance: Number(user.balance),
    };
  }
}
