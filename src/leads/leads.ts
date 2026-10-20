import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Prisma, type Lead } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AdminGuard } from '../admin/auth/admin.guard';
import { paged, pageQuery, sendCsv, UuidPipe } from '../admin/http';
import { AppError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parseOrThrow } from '../common/validation';
import { EmailAlertService } from './email';

const KINDS = ['pilot', 'demo', 'partner', 'contact'] as const;
const STATUSES = ['new', 'contacted', 'qualified', 'won', 'closed', 'spam'] as const;

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), text(max).optional());

export const leadSchema = z
  .object({
    kind: z.enum(KINDS),
    name: text(120).min(2, 'Please enter your name'),
    email: text(200).email('Please enter a valid email address'),
    phone: optional(40),
    institution: optional(200),
    website: optional(300),
    role: optional(120),
    country: optional(80),
    size: optional(60),
    message: text(4000).min(10, 'Please write at least a sentence'),
    sourcePage: optional(300),
    /** Honeypot: hidden on the form, so only bots fill it. */
    company: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'pilot' || v.kind === 'demo') {
      if (!v.institution) ctx.addIssue({ code: 'custom', path: ['institution'], message: 'Please enter your institution' });
    }
    if (v.kind === 'pilot' && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Please enter a phone number' });
    if (v.phone && !/^[+()\d\s-]{6,40}$/.test(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Please enter a valid phone number' });
    if (v.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v.website)) {
      ctx.addIssue({ code: 'custom', path: ['website'], message: 'Please enter a valid website address' });
    }
  });

/** In-memory limits: enough to stop a script hammering the form, never in a real visitor's way. */
const PER_IP = { max: 5, windowMs: 15 * 60_000 };
const GLOBAL = { max: 120, windowMs: 60 * 60_000 };
const hits = new Map<string, number[]>();

function allow(key: string, limit: { max: number; windowMs: number }, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  if (recent.length >= limit.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Test hook. */
export function resetLeadLimits(): void {
  hits.clear();
}

/** The visitor's address: Cloudflare's header when present, else Express's (trust proxy). */
function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return (typeof cf === 'string' && cf) || req.ip || 'unknown';
}

/**
 * CORS for the public lead form only: the website (another origin) posts here from the browser.
 * Every other route stays same-origin.
 */
export function leadsCors(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

@Injectable()
export class LeadsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailAlertService) private readonly email: EmailAlertService,
  ) {}

  async create(body: unknown, req: Request): Promise<{ ok: true }> {
    const dto = parseOrThrow(leadSchema, body);
    // A bot filled the hidden field: answer like a success so it learns nothing.
    if (dto.company) return { ok: true };
    const ip = clientIp(req);
    const now = Date.now();
    if (!allow(`ip:${ip}`, PER_IP, now) || !allow('global', GLOBAL, now)) {
      throw new AppError('rate_limited', 'Too many requests. Please try again in a few minutes, or email us.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const { company: _hp, website, ...rest } = dto;
    const lead = await this.prisma.lead.create({
      data: {
        ...rest,
        email: rest.email.toLowerCase(),
        website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
        ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      },
    });
    void this.email.notifyLead(lead);
    return { ok: true };
  }
}

@Controller('v1/leads')
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  /** Public: the scholametrix.tech forms (pilot, demo, partnership, contact). No API key. */
  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: Request) {
    return this.leads.create(body, req);
  }
}

// ── Operator console ────────────────────────────────────────────────────────────────────────────

const listQuery = pageQuery.extend({
  status: z.enum(STATUSES).optional(),
  kind: z.enum(KINDS).optional(),
  q: z.string().trim().max(200).optional(),
});
const updateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.note !== undefined, 'Nothing to change');

const view = (l: Lead) => ({
  id: l.id,
  kind: l.kind,
  status: l.status,
  name: l.name,
  email: l.email,
  phone: l.phone,
  institution: l.institution,
  website: l.website,
  role: l.role,
  country: l.country,
  size: l.size,
  message: l.message,
  sourcePage: l.sourcePage,
  note: l.note,
  contactedAt: l.contactedAt?.toISOString() ?? null,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

/** A spreadsheet must not run a visitor's text as a formula. */
const cell = (v: string | null) => {
  if (v === null) return '';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Controller('admin-api/leads')
@UseGuards(AdminGuard)
export class LeadsAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private where(q: { status?: Lead['status']; kind?: Lead['kind']; q?: string }): Prisma.LeadWhereInput {
    return {
      ...(q.status ? { status: q.status } : { status: { not: 'spam' } }),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q
        ? {
            OR: (['name', 'email', 'institution', 'phone', 'message'] as const).map((f) => ({
              [f]: { contains: q.q, mode: 'insensitive' as const },
            })),
          }
        : {}),
    };
  }

  @Get()
  async list(@Query() query: unknown) {
    const q = parseOrThrow(listQuery, query);
    const where = this.where(q);
    const [items, total, byStatus] = await Promise.all([
      this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<(typeof STATUSES)[number], number>;
    for (const g of byStatus) counts[g.status] = g._count._all;
    return { ...paged(items.map(view), total, q.page, q.pageSize), counts };
  }

  @Get('export.csv')
  async csv(@Query() query: unknown, @Res() res: Response) {
    const q = parseOrThrow(listQuery, query);
    const rows = await this.prisma.lead.findMany({ where: this.where(q), orderBy: { createdAt: 'desc' }, take: 5_000 });
    const head = ['Received', 'Type', 'Status', 'Name', 'Email', 'Phone', 'Institution', 'Website', 'Role', 'Country', 'Size', 'Message', 'Note'];
    const lines = rows.map((l) =>
      [l.createdAt.toISOString(), l.kind, l.status, l.name, l.email, l.phone, l.institution, l.website, l.role, l.country, l.size, l.message, l.note]
        .map(cell)
        .join(','),
    );
    sendCsv(res, 'leads.csv', [head.join(','), ...lines].join('\n'));
  }

  @Patch(':id')
  async update(@Param('id', new UuidPipe()) id: string, @Body() body: unknown) {
    const dto = parseOrThrow(updateSchema, body);
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw notFound('Lead');
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.note !== undefined ? { note: dto.note || null } : {}),
        ...(dto.status && dto.status !== 'new' && !lead.contactedAt ? { contactedAt: new Date() } : {}),
      },
    });
    return view(updated);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new UuidPipe()) id: string) {
    const { count } = await this.prisma.lead.deleteMany({ where: { id } });
    if (!count) throw notFound('Lead');
  }
}
