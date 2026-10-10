import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parseOrThrow } from '../../common/validation';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdminAuthService, adminView, type AdminIdentity } from './admin-auth.service';
import {
  AdminGuard,
  assertCsrfHeader,
  clearSessionCookie,
  CurrentAdmin,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from './admin.guard';

const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });
const passwordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });
const createAdminSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
const updateAdminSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional() });

@Controller('admin-api/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    assertCsrfHeader(req);
    const dto = parseOrThrow(loginSchema, body);
    const { token, admin, expiresAt } = await this.auth.login(dto.email, dto.password, req.ip ?? 'unknown', req.headers['user-agent']);
    setSessionCookie(res, this.env, token, this.auth.sessionMs);
    return { admin, expiresAt: expiresAt.toISOString() };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await this.auth.logout(token);
    clearSessionCookie(res, this.env);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AdminIdentity) {
    return { id: admin.id, email: admin.email, name: admin.name, publicUrl: this.env.PUBLIC_URL ?? null };
  }

  @Post('password')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async password(@CurrentAdmin() admin: AdminIdentity, @Body() body: unknown) {
    const dto = parseOrThrow(passwordSchema, body);
    await this.auth.changePassword(admin, dto.current, dto.next);
  }

  @Get('sessions')
  @UseGuards(AdminGuard)
  async sessions(@CurrentAdmin() admin: AdminIdentity) {
    const rows = await this.auth.sessions(admin.id);
    return rows.map((s) => ({
      ...s,
      current: s.id === admin.sessionId,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  @Delete('sessions')
  @UseGuards(AdminGuard)
  async signOutOthers(@CurrentAdmin() admin: AdminIdentity) {
    return { signedOut: await this.auth.signOutOthers(admin) };
  }
}

/** Other console accounts. Every admin has full access; keep the list short. */
@Controller('admin-api/admins')
@UseGuards(AdminGuard)
export class AdminsController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(adminView);
  }

  @Post()
  async create(@Body() body: unknown) {
    return adminView(await this.auth.createAdmin(parseOrThrow(createAdminSchema, body)));
  }

  @Patch(':id')
  async update(@CurrentAdmin() me: AdminIdentity, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(updateAdminSchema, body);
    if (id === me.id && dto.active === false) {
      throw new AppError('validation_failed', 'You can’t deactivate your own account', HttpStatus.BAD_REQUEST);
    }
    const exists = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!exists) throw notFound('Admin');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.adminUser.update({ where: { id }, data: dto });
      if (dto.active === false) await tx.adminSession.deleteMany({ where: { adminId: id } });
      return row;
    });
    return adminView(updated);
  }
}
