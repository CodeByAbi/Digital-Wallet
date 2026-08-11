import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/**
 * Auth controller — routes under /api/v1 (global prefix set in main.ts)
 * POST /api/v1/register  → 201
 * POST /api/v1/login     → 200
 *
 * Controllers return plain objects. The global ResponseInterceptor wraps them
 * in { status: "SUCCESS", result: ... } per SRS 1.3.
 */
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
