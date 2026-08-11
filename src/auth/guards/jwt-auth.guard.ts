import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';

const BEARER_PREFIX = 'Bearer ';

export interface AuthenticatedRequest extends Request {
  user_id?: string;
}

/**
 * Verifies the access_token on protected routes (SRS Section 4).
 * Not applied to any controller yet — wired in per-route starting Phase 4.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice(BEARER_PREFIX.length);

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      request.user_id = payload.sub;
      return true;
    } catch {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Invalid or expired access token',
      );
    }
  }
}
