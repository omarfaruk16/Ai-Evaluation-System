import { Body, Controller, Get, HttpStatus, Inject, Injectable, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { generateApiKey, generateWebhookSecret, openApiKey, sealApiKey } from '../auth/api-key';
import { clearApiKeyCache } from '../auth/api-key.guard';
import { AppError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { parseOrThrow } from '../common/validation';
import { WebhookService } from '../webhooks/webhook.service';
import { AdminGuard } from './auth/admin.guard';
import { computeCharges, type UsageCounts } from './billing/billing.calc';
import { BillingService } from './billing/billing.service';
import { UuidPipe } from './http';
import { currentMonth, monthPeriod, shiftMonth } from './time';
import { clientView, invoiceMonth, planTerms, webhookView } from './views';

const NO_USAGE: UsageCounts = { completed: 0, blank: 0, reused: 0, failed: 0, rubricDrafts: 0, costUsd: 0 };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

const webhookUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u), 'use an http(s) URL')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

const clientSchema = z.object({
  name: z.string().trim().min(1).max(100),
  webhookUrl,
  planId: z.string().uuid().nullable().optional(),
  monthlyBudgetUsd: z.number().min(0).max(1e7).nullable().optional(),
  contactName: optionalText(200),
  contactEmail: optionalText(200),
  billingAddress: optionalText(1000),
  notes: optionalText(2000),
});
const updateSchema = clientSchema.partial().extend({ active: z.boolean().optional() });

@Injectable()
export class ClientsAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list() {
    const settings = await this.billing.settings();
    const period = monthPeriod(currentMonth(settings.timeZone), settings.timeZone);
    const [clients, usage] = await Promise.all([
      this.prisma.client.findMany({ include: { plan: true }, orderBy: { createdAt: 'asc' } }),
      this.billing.usageByClient(period.start, period.end),
    ]);
    return clients.map((c) => {
      const u = usage.get(c.id) ?? NO_USAGE;
      const rate = c.plan ? settings.fxRates[c.plan.currency] : undefined;
      return {
        ...clientView(c),
        month: {
          answers: u.completed,
          failed: u.failed,
          costUsd: u.costUsd,
          // Billed so far this month, in the plan's currency (before tax).
          revenue: c.plan && rate ? computeCharges(u, planTerms(c.plan), rate).subtotal : null,
        },
      };
    });
  }

  async detail(id: string) {
    const c = await this.prisma.client.findUnique({ where: { id }, include: { plan: true } });
    if (!c) throw notFound('Client');
    const settings = await this.billing.settings();
    const now = currentMonth(settings.timeZone);
    const months = await Promise.all(
      Array.from({ length: 6 }, (_, i) => shiftMonth(now, -5 + i)).map(async (month) => {
        const p = monthPeriod(month, settings.timeZone);
        const u = (await this.billing.usageByClient(p.start, p.end, id)).get(id);
        const rate = c.plan ? settings.fxRates[c.plan.currency] : undefined;
        const usage = u ?? NO_USAGE;
        const existed = c.createdAt < p.end;
        return { month, usage, charges: existed && c.plan && rate ? computeCharges(usage, planTerms(c.plan), rate) : null };
      }),
    );
    const [byStatus, webhooks, invoices] = await Promise.all([
      this.prisma.evaluation.groupBy({ by: ['status'], where: { clientId: id }, _count: { _all: true } }),
      this.prisma.webhookDelivery.findMany({ where: { clientId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.invoice.findMany({
        where: { clientId: id },
        orderBy: { periodStart: 'desc' },
        take: 12,
        select: { id: true, number: true, status: true, total: true, currency: true, periodStart: true, parties: true },
      }),
    ]);
    return {
      client: clientView(c),
      months,
      evaluations: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      webhooks: webhooks.map(webhookView),
      invoices: invoices.map(({ parties: _p, ...i }) => ({
        ...i,
        month: invoiceMonth({ periodStart: i.periodStart, parties: _p }),
        total: Number(i.total),
        periodStart: i.periodStart.toISOString(),
      })),
    };
  }

  async create(input: z.infer<typeof clientSchema>) {
    await this.assertPlan(input.planId);
    const key = generateApiKey();
    const webhookSecret = generateWebhookSecret();
    const c = await this.unique(() =>
      this.prisma.client.create({
        data: {
          name: input.name,
          apiKeyHash: key.hash,
          apiKeyPrefix: key.prefix,
          apiKeyEncrypted: sealApiKey(key.key, this.env.SECRETS_ENCRYPTION_KEY),
          webhookSecret,
          webhookUrl: input.webhookUrl ?? null,
          planId: input.planId ?? null,
          monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          billingAddress: input.billingAddress ?? null,
          notes: input.notes ?? null,
        },
        include: { plan: true },
      }),
    );
    return { client: clientView(c), apiKey: key.key, webhookSecret };
  }

  async update(id: string, input: z.infer<typeof updateSchema>) {
    await this.find(id);
    await this.assertPlan(input.planId);
    const c = await this.unique(() => this.prisma.client.update({ where: { id }, data: input, include: { plan: true } }));
    clearApiKeyCache();
    return clientView(c);
  }

  async rotateKey(id: string) {
    await this.find(id);
    const key = generateApiKey();
    const c = await this.prisma.client.update({
      where: { id },
      data: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyEncrypted: sealApiKey(key.key, this.env.SECRETS_ENCRYPTION_KEY) },
      include: { plan: true },
    });
    clearApiKeyCache();
    return { client: clientView(c), apiKey: key.key };
  }

  /** The project's current API key, for an operator to copy again. */
  async revealKey(id: string) {
    const c = await this.find(id);
    if (!this.env.SECRETS_ENCRYPTION_KEY) {
      throw new AppError('conflict', 'Keys are not stored on this server (SECRETS_ENCRYPTION_KEY is not set). Rotate the key to get a new one.', HttpStatus.CONFLICT);
    }
    if (!c.apiKeyEncrypted) {
      throw new AppError('conflict', 'This key was created before keys were stored. Rotate it once; from then on it can be copied here.', HttpStatus.CONFLICT);
    }
    const apiKey = openApiKey(c.apiKeyEncrypted, this.env.SECRETS_ENCRYPTION_KEY);
    if (!apiKey) {
      throw new AppError('conflict', 'The stored key can’t be decrypted (SECRETS_ENCRYPTION_KEY changed). Rotate the key to store a new one.', HttpStatus.CONFLICT);
    }
    return { apiKey };
  }

  async rotateWebhookSecret(id: string) {
    await this.find(id);
    const webhookSecret = generateWebhookSecret();
    const c = await this.prisma.client.update({ where: { id }, data: { webhookSecret }, include: { plan: true } });
    return { client: clientView(c), webhookSecret };
  }

  /** Sends a signed `ping` event to the client's webhook URL and reports what came back. */
  async testWebhook(id: string) {
    const c = await this.find(id);
    if (!c.webhookUrl) throw new AppError('validation_failed', 'This client has no webhook URL', HttpStatus.BAD_REQUEST);
    return this.webhooks.ping(c.webhookUrl, c.webhookSecret);
  }

  private async find(id: string) {
    const c = await this.prisma.client.findUnique({ where: { id } });
    if (!c) throw notFound('Client');
    return c;
  }

  private async assertPlan(planId: string | null | undefined) {
    if (!planId) return;
    const plan = await this.prisma.pricingPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new AppError('validation_failed', 'Unknown pricing plan', HttpStatus.BAD_REQUEST);
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('conflict', 'A client with this name already exists', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }
}

@Controller('admin-api/clients')
@UseGuards(AdminGuard)
export class ClientsAdminController {
  constructor(@Inject(ClientsAdminService) private readonly clients: ClientsAdminService) {}

  @Get()
  list() {
    return this.clients.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.clients.create(parseOrThrow(clientSchema, body));
  }

  @Get(':id')
  detail(@Param('id', new UuidPipe()) id: string) {
    return this.clients.detail(id);
  }

  @Patch(':id')
  update(@Param('id', new UuidPipe()) id: string, @Body() body: unknown) {
    return this.clients.update(id, parseOrThrow(updateSchema, body));
  }

  @Post(':id/rotate-key')
  rotateKey(@Param('id', new UuidPipe()) id: string) {
    return this.clients.rotateKey(id);
  }

  // POST, not GET, so the console's CSRF header is required to read a key.
  @Post(':id/reveal-key')
  revealKey(@Param('id', new UuidPipe()) id: string) {
    return this.clients.revealKey(id);
  }

  @Post(':id/rotate-webhook-secret')
  rotateWebhookSecret(@Param('id', new UuidPipe()) id: string) {
    return this.clients.rotateWebhookSecret(id);
  }

  @Post(':id/test-webhook')
  testWebhook(@Param('id', new UuidPipe()) id: string) {
    return this.clients.testWebhook(id);
  }
}
