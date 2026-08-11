import { Injectable, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';

const BCRYPT_COST = 10;

export interface RegisterResult {
  user_id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  address: string;
  created_date: string;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  /** access_token TTL in seconds */
  expires_in: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // REGISTER
  // ---------------------------------------------------------------------------
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const pinHash = await bcrypt.hash(dto.pin, BCRYPT_COST);

    let user: { id: string; firstName: string; lastName: string; phoneNumber: string; address: string; createdAt: Date };
    try {
      user = await this.prisma.user.create({
        data: {
          firstName: dto.first_name,
          lastName: dto.last_name,
          phoneNumber: dto.phone_number,
          address: dto.address,
          pinHash,
          balance: BigInt(0),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          address: true,
          createdAt: true,
        },
      });
    } catch (err: unknown) {
      // Prisma unique constraint violation code
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'PHONE_NUMBER_ALREADY_REGISTERED',
          'Phone Number already registered',
        );
      }
      throw err;
    }

    // Pin is NEVER returned — only safe fields are returned
    return {
      user_id: user.id,
      first_name: user.firstName,
      last_name: user.lastName,
      phone_number: user.phoneNumber,
      address: user.address,
      created_date: user.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------
  async login(dto: LoginDto): Promise<LoginResult> {
    // Step 1: find user by phone_number
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phone_number },
      select: {
        id: true,
        pinHash: true,
      },
    });

    // Step 2: verify — same error for "not found" and "wrong pin" to prevent enumeration
    const pinMatches =
      user !== null && (await bcrypt.compare(dto.pin, user.pinHash));

    if (!pinMatches) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        "Phone number and pin doesn't match",
      );
    }

    // Step 3: generate tokens
    const payload = { sub: user.id };

    const accessSecret = this.config.get<string>('JWT_SECRET');
    const refreshSecret = this.config.get<string>('JWT_SECRET');
    const accessExpiry = this.config.get<string>('JWT_ACCESS_EXPIRY') ?? '15m';
    const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRY') ?? '7d';

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiry as StringValue,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpiry as StringValue,
    });

    // Step 4: store HASH of refresh_token (not plaintext) per SRS Section 4
    const refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_COST);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900, // 15m in seconds per SRS 3.2
    };
  }
}
