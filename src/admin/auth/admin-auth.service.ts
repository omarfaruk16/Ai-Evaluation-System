import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type AdminUser } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { sha256 } from '../../common/text';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './password';

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IP = 20;
const MAX_FAILS_PER_EMAIL = 8;
const TOUCH_EVERY_MS = 60_000;

export const adminView = (a: AdminUser) => ({
  id: a.id,
  email: a.email,
  name: a.name,
  active: a.active,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

/** Console accounts: scrypt passwords, opaque session tokens (only their hash is stored). */
@Injectable()
export class AdminAuthService {
  private readonly fails = new Map<string, number[]>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get sessionMs(): number {
    return this.env.ADMIN_SESSION_HOURS * 3_600_000;
  }

  async login(emailRaw: string, password: string, ip: string, userAgent: string | undefined) {
    const email = emailRaw.trim().toLowerCase();
    this.assertNotLocked(`ip:${ip}`, MAX_FAILS_PER_IP);
    this.assertNotLocked(`email:${email}`, MAX_FAILS_PER_EMAIL);

    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    const ok = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok || !admin.active) {
      this.fail(`ip:${ip}`);
      this.fail(`email:${email}`);
      throw new AppError('unauthorized', 'Wrong email or password', HttpStatus.UNAUTHORIZED);
    }
    this.fails.delete(`email:${email}`);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionMs);
    await this.prisma.$transaction([
      this.prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.adminSession.create({
        data: { tokenHash: sha256(token), adminId: admin.id, expiresAt, ip, userAgent: userAgent?.slice(0, 300) ?? null },
      }),
      this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
    ]);
    return { token, expiresAt, admin: adminView(admin) };
  }

  /** The signed-in admin for a session token, or null. Extends the session while it is used. */
  async validate(token: string): Promise<AdminIdentity | null> {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { admin: true },
    });
    if (!session || session.expiresAt < new Date() || !session.admin.active) return null;
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.adminSession
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + this.sessionMs) },
        })
        .catch(() => undefined);
    }
    return { id: session.admin.id, email: session.admin.email, name: session.admin.name, sessionId: session.id };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.adminSession.deleteMany({ where: { tokenHash: sha256(token) } });
  }

  async changePassword(admin: AdminIdentity, current: string, next: string): Promise<void> {
    const row = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await verifyPassword(current, row.passwordHash))) {
      throw new AppError('validation_failed', 'Your current password is wrong', HttpStatus.BAD_REQUEST);
    }
    const problem = passwordProblem(next);
    if (problem) throw new AppError('validation_failed', problem, HttpStatus.BAD_REQUEST);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next) } }),
      // Sign out every other device.
      this.prisma.adminSession.deleteMany({ where: { adminId: admin.id, id: { not: admin.sessionId } } }),
    ]);
  }

  async createAdmin(input: { email: string; name: string; password: string }) {
    const problem = passwordProblem(input.password);
    if (problem) throw new AppError('validation_failed', problem, HttpStatus.BAD_REQUEST);
    try {
      return await this.prisma.adminUser.create({
        data: {
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          passwordHash: await hashPassword(input.password),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('conflict', 'An admin with this email already exists', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  async sessions(adminId: string) {
    return this.prisma.adminSession.findMany({
      where: { adminId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
  }

  async signOutOthers(admin: AdminIdentity): Promise<number> {
    const r = await this.prisma.adminSession.deleteMany({ where: { adminId: admin.id, id: { not: admin.sessionId } } });
    return r.count;
  }

  private recent(key: string): number[] {
    const cutoff = Date.now() - FAIL_WINDOW_MS;
    const list = (this.fails.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length > 0) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  private assertNotLocked(key: string, max: number): void {
    if (this.recent(key).length >= max) {
      throw new AppError('rate_limited', 'Too many failed sign-ins. Wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private fail(key: string): void {
    this.fails.set(key, [...this.recent(key), Date.now()]);
  }
}
