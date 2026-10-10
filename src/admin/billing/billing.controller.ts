import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parseOrThrow } from '../../common/validation';
import { AdminGuard } from '../auth/admin.guard';
import { sendCsv, UuidPipe } from '../http';
import { planView } from '../views';
import { BillingService } from './billing.service';
import { billingSettingsSchema } from './billing.settings';

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const invoiceCreate = z.object({ clientId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/) });
const invoiceUpdate = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const invoiceList = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional(),
  clientId: z.string().uuid().optional(),
});

const money = z.number().min(0).max(1e9);
const planSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    billingModel: z.enum(['per_answer', 'cost_plus']),
    monthlyFee: money.default(0),
    includedAnswers: z.number().int().min(0).max(1e8).default(0),
    pricePerAnswer: money.default(0),
    pricePerRubricDraft: money.default(0),
    markupPercent: z.number().min(0).max(10_000).default(0),
    chargeBlank: z.boolean().default(false),
    chargeReused: z.boolean().default(true),
    taxPercent: z.number().min(0).max(100).default(0),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

@Controller('admin-api/billing')
@UseGuards(AdminGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('settings')
  settings() {
    return this.billing.settings();
  }

  @Put('settings')
  saveSettings(@Body() body: unknown) {
    return this.billing.saveSettings(parseOrThrow(billingSettingsSchema, body));
  }

  @Get('statements')
  statements(@Query() q: unknown) {
    return this.billing.statements(parseOrThrow(monthQuery, q).month);
  }

  @Get('statements.csv')
  async statementsCsv(@Query() q: unknown, @Res() res: Response) {
    const { month } = parseOrThrow(monthQuery, q);
    const csv = await this.billing.statementsCsv(month);
    sendCsv(res, `statements-${month ?? 'current'}.csv`, csv);
  }

  @Get('unit-costs')
  unitCosts(@Query('days') days?: string) {
    const n = Math.min(365, Math.max(1, Number(days) || 30));
    return this.billing.unitCosts(n);
  }

  @Get('invoices')
  invoices(@Query() q: unknown) {
    return this.billing.listInvoices(parseOrThrow(invoiceList, q));
  }

  @Get('invoices.csv')
  async invoicesCsv(@Res() res: Response) {
    sendCsv(res, 'invoices.csv', await this.billing.invoicesCsv());
  }

  @Post('invoices')
  createInvoice(@Body() body: unknown) {
    const dto = parseOrThrow(invoiceCreate, body);
    return this.billing.createInvoice(dto.clientId, dto.month);
  }

  @Get('invoices/:id')
  invoice(@Param('id', new UuidPipe()) id: string) {
    return this.billing.getInvoice(id);
  }

  @Patch('invoices/:id')
  updateInvoice(@Param('id', new UuidPipe()) id: string, @Body() body: unknown) {
    return this.billing.updateInvoice(id, parseOrThrow(invoiceUpdate, body));
  }

  @Delete('invoices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteInvoice(@Param('id', new UuidPipe()) id: string) {
    return this.billing.deleteInvoice(id);
  }
}

@Controller('admin-api/plans')
@UseGuards(AdminGuard)
export class PlansController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const plans = await this.prisma.pricingPlan.findMany({
      orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { clients: true } } },
    });
    return plans.map((p) => ({ ...planView(p), clients: p._count.clients }));
  }

  @Post()
  async create(@Body() body: unknown) {
    const dto = parseOrThrow(planSchema, body);
    return planView(await this.unique(() => this.prisma.pricingPlan.create({ data: dto })));
  }

  @Patch(':id')
  async update(@Param('id', new UuidPipe()) id: string, @Body() body: unknown) {
    const dto = parseOrThrow(planSchema.partial().extend({ archived: z.boolean().optional() }), body);
    await this.find(id);
    return planView(await this.unique(() => this.prisma.pricingPlan.update({ where: { id }, data: dto })));
  }

  /** Deletes an unused plan; a plan clients still use can only be archived. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new UuidPipe()) id: string) {
    await this.find(id);
    const used = await this.prisma.client.count({ where: { planId: id } });
    if (used > 0) {
      throw new AppError('conflict', `${used} client(s) use this plan. Move them to another plan or archive it.`, HttpStatus.CONFLICT);
    }
    await this.prisma.pricingPlan.delete({ where: { id } });
  }

  private async find(id: string) {
    const p = await this.prisma.pricingPlan.findUnique({ where: { id } });
    if (!p) throw notFound('Plan');
    return p;
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new AppError('conflict', 'A plan with this name already exists', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }
}
