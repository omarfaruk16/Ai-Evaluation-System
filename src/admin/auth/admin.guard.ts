import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../common/errors';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdminAuthService, type AdminIdentity } from './admin-auth.service';

export const SESSION_COOKIE = 'ams_admin';
/** The console sends this on every change. A cross-site form or link can't set a custom header. */
export const CSRF_HEADER = 'x-ams-console';
const COOKIE_PATH = '/admin-api';

type AdminRequest = Request & { admin?: AdminIdentity };

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function setSessionCookie(res: Response, env: Env, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.ADMIN_COOKIE_SECURE ?? env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.ADMIN_COOKIE_SECURE ?? env.NODE_ENV === 'production',
    path: COOKIE_PATH,
  });
}

export function assertCsrfHeader(req: Request): void {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (!safe && req.headers[CSRF_HEADER] !== '1') {
    throw new AppError('forbidden', 'Missing console request header', HttpStatus.FORBIDDEN);
  }
}

/** Every /admin-api route except sign-in: a valid session cookie, plus the CSRF header on changes. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    assertCsrfHeader(req);
    const token = readCookie(req, SESSION_COOKIE);
    const admin = token ? await this.auth.validate(token) : null;
    if (!admin) {
      clearSessionCookie(ctx.switchToHttp().getResponse<Response>(), this.env);
      throw new AppError('unauthorized', 'Sign in to the console', HttpStatus.UNAUTHORIZED);
    }
    req.admin = admin;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminIdentity => ctx.switchToHttp().getRequest<AdminRequest>().admin!,
);
