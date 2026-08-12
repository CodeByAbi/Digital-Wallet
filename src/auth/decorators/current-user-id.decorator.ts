import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * Extracts user_id attached by JwtAuthGuard. Only valid on routes guarded
 * by JwtAuthGuard — request.user_id is guaranteed set there.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user_id as string;
  },
);
