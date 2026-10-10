import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type InvoiceStatus } from '@prisma/client';
import { AppError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ProfileService } from '../../llm/profile.service';
import { markingPromptBaseTokens } from '../../marking/prompts';
import { SettingsService } from '../../settings/settings.service';
import { currentMonth, monthPeriod, type Period } from '../time';
import { invoiceView, planTerms } from '../views';
import { computeCharges, type Charges, type UsageCounts } from './billing.calc';
import { BILLING_DEFAULTS, BILLING_KEY, billingSettingsSchema, type BillingSettings } from './billing.settings';

const emptyUsage = (): UsageCounts => ({ completed: 0, blank: 0, reused: 0, failed: 0, rubricDrafts: 0, costUsd: 0 });

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  // A sent invoice is never edited back into a draft: void it and create a new one.
  issued: ['paid', 'void'],
  paid: ['issued'],
  void: [],
};

/** Statements (live), invoices (frozen) and the unit costs behind the quote calculator. */
@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settingsStore: SettingsService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  // ───────────────────────── Settings ─────────────────────────

  async settings(): Promise<BillingSettings> {
    const stored = await this.settingsStore.get<BillingSettings>(BILLING_KEY, BILLING_DEFAULTS);
    const parsed = billingSettingsSchema.safeParse(stored);
    return parsed.success ? parsed.data : BILLING_DEFAULTS;
  }

  async saveSettings(input: BillingSettings): Promise<BillingSettings> {
    return this.settingsStore.set(BILLING_KEY, input);
  }

  fx(currency: string, s: BillingSettings): number {
    const rate = s.fxRates[currency];
    if (!rate) {
      throw new AppError(
        'validation_failed',
        `No exchange rate for ${currency}. Add it under Billing settings.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return rate;
  }

  async period(month?: string): Promise<Period & { timeZone: string }> {
    const { timeZone } = await this.settings();
    const m = month ?? currentMonth(timeZone);
    try {
      return { ...monthPeriod(m, timeZone), timeZone };
    } catch {
      throw new AppError('validation_failed', 'month must look like 2026-10', HttpStatus.BAD_REQUEST);
    }
  }

  // ───────────────────────── Usage ─────────────────────────

  /**
   * Activity per client in [start, end). Answers count in the month they finished marking;
   * AI cost counts when the call was made.
   */
  async usageByClient(start: Date, end: Date, clientId?: string): Promise<Map<string, UsageCounts>> {
    const clientFilter = clientId ? Prisma.sql`AND "clientId" = ${clientId}` : Prisma.empty;
    const [evals, drafts, costs] = await Promise.all([
      this.prisma.$queryRaw<
        { clientId: string; completed: bigint; blank: bigint; reused: bigint; failed: bigint }[]
      >(Prisma.sql`
        SELECT "clientId",
          count(*) FILTER (WHERE status = 'completed') AS completed,
          count(*) FILTER (WHERE status = 'completed' AND 'blank' = ANY(flags)) AS blank,
          count(*) FILTER (WHERE status = 'completed' AND "reusedFromId" IS NOT NULL) AS reused,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM "Evaluation"
        WHERE "completedAt" >= ${start} AND "completedAt" < ${end} ${clientFilter}
        GROUP BY "clientId"`),
      this.prisma.rubricDraft.groupBy({
        by: ['clientId'],
        where: { origin: 'client', ok: true, createdAt: { gte: start, lt: end }, ...(clientId ? { clientId } : {}) },
        _count: { _all: true },
      }),
      this.prisma.llmCall.groupBy({
        by: ['clientId'],
        where: { origin: 'client', createdAt: { gte: start, lt: end }, ...(clientId ? { clientId } : {}) },
        _sum: { costUsd: true },
      }),
    ]);
    const out = new Map<string, UsageCounts>();
    const get = (id: string) => {
      let u = out.get(id);
      if (!u) out.set(id, (u = emptyUsage()));
      return u;
    };
    for (const r of evals) {
      Object.assign(get(r.clientId), {
        completed: Number(r.completed),
        blank: Number(r.blank),
        reused: Number(r.reused),
        failed: Number(r.failed),
      });
    }
    for (const r of drafts) if (r.clientId) get(r.clientId).rubricDrafts = r._count._all;
    for (const r of costs) if (r.clientId) get(r.clientId).costUsd = Number(r._sum.costUsd ?? 0);
    return out;
  }

  // ───────────────────────── Statements ─────────────────────────

  async statements(month?: string) {
    const period = await this.period(month);
    const settings = await this.settings();
    const [clients, usage, invoices] = await Promise.all([
      this.prisma.client.findMany({ include: { plan: true }, orderBy: { name: 'asc' } }),
      this.usageByClient(period.start, period.end),
      this.prisma.invoice.findMany({
        where: { periodStart: period.start, status: { not: 'void' } },
        select: { id: true, clientId: true, number: true, status: true, total: true, currency: true },
      }),
    ]);
    const invoiceByClient = new Map(invoices.map((i) => [i.clientId, i]));
    const rows = clients
      // A client is billed from the month it was created.
      .filter((c) => c.createdAt < period.end)
      .map((c) => {
        const u = usage.get(c.id) ?? emptyUsage();
        const inv = invoiceByClient.get(c.id);
        return {
          client: { id: c.id, name: c.name, active: c.active },
          plan: c.plan ? { id: c.plan.id, name: c.plan.name, currency: c.plan.currency, billingModel: c.plan.billingModel } : null,
          usage: u,
          charges: c.plan ? this.charges(u, c.plan, settings) : null,
          invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, total: Number(inv.total), currency: inv.currency } : null,
        };
      })
      // Hide disabled clients with nothing to bill.
      .filter((r) => r.client.active || r.usage.completed + r.usage.failed + r.usage.rubricDrafts > 0 || r.usage.costUsd > 0);

    const totals: Record<string, { subtotal: number; tax: number; total: number; cost: number; margin: number }> = {};
    for (const r of rows) {
      if (!r.charges || !r.plan) continue;
      const t = (totals[r.plan.currency] ??= { subtotal: 0, tax: 0, total: 0, cost: 0, margin: 0 });
      t.subtotal += r.charges.subtotal;
      t.tax += r.charges.tax;
      t.total += r.charges.total;
      t.cost += r.charges.cost;
      t.margin += r.charges.margin;
    }
    const costUsd = [...usage.values()].reduce((s, u) => s + u.costUsd, 0);
    const consoleCost = await this.prisma.llmCall.aggregate({
      where: { origin: 'console', createdAt: { gte: period.start, lt: period.end } },
      _sum: { costUsd: true },
    });
    return {
      month: period.month,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      timeZone: period.timeZone,
      fxRates: settings.fxRates,
      rows,
      totals,
      costUsd: Number(costUsd.toFixed(6)),
      consoleCostUsd: Number(consoleCost._sum.costUsd ?? 0),
    };
  }

  private charges(u: UsageCounts, plan: Parameters<typeof planTerms>[0], s: BillingSettings): Charges | null {
    const rate = s.fxRates[plan.currency];
    return rate ? computeCharges(u, planTerms(plan), rate) : null;
  }

  // ───────────────────────── Invoices ─────────────────────────

  async createInvoice(clientId: string, month: string) {
    const period = await this.period(month);
    const settings = await this.settings();
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, include: { plan: true } });
    if (!client) throw notFound('Client');
    if (client.createdAt >= period.end) {
      throw new AppError('validation_failed', `${client.name} did not exist yet in ${period.month}`, HttpStatus.BAD_REQUEST);
    }
    if (!client.plan) {
      throw new AppError('validation_failed', `${client.name} has no pricing plan. Assign one first.`, HttpStatus.BAD_REQUEST);
    }
    const existing = await this.prisma.invoice.findFirst({
      where: { clientId, periodStart: period.start, status: { not: 'void' } },
    });
    if (existing) {
      throw new AppError('conflict', `Invoice ${existing.number} already covers this month. Void it to make a new one.`, HttpStatus.CONFLICT);
    }
    const usage = (await this.usageByClient(period.start, period.end, clientId)).get(clientId) ?? emptyUsage();
    const terms = planTerms(client.plan);
    const fx = this.fx(terms.currency, settings);
    const charges = computeCharges(usage, terms, fx);
    const parties = {
      to: {
        name: client.contactName || client.name,
        organisation: client.name,
        email: client.contactEmail ?? '',
        address: client.billingAddress ?? '',
      },
      from: {
        name: settings.businessName,
        address: settings.businessAddress,
        email: settings.businessEmail,
        phone: settings.businessPhone,
        paymentDetails: settings.paymentDetails,
        footer: settings.invoiceFooter,
      },
      plan: client.plan.name,
      usage,
      timeZone: period.timeZone,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const number = await this.nextNumber(settings.invoicePrefix, period.month.slice(0, 4));
      try {
        const inv = await this.prisma.invoice.create({
          data: {
            number,
            clientId,
            periodStart: period.start,
            periodEnd: period.end,
            currency: terms.currency,
            parties: parties as unknown as Prisma.InputJsonValue,
            lines: charges.lines as unknown as Prisma.InputJsonValue,
            subtotal: charges.subtotal,
            taxPercent: terms.taxPercent,
            tax: charges.tax,
            total: charges.total,
            costUsd: charges.costUsd,
            fxUsdRate: fx,
          },
          include: { client: { select: { id: true, name: true } } },
        });
        return invoiceView(inv);
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new AppError('conflict', 'Could not allocate an invoice number. Try again.', HttpStatus.CONFLICT);
  }

  /** PREFIX + year + 4-digit sequence, e.g. AMS-2026-0007. */
  private async nextNumber(prefix: string, year: string): Promise<string> {
    const start = `${prefix}${year}-`;
    const last = await this.prisma.invoice.findFirst({
      where: { number: { startsWith: start } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const seq = last ? Number(last.number.slice(start.length)) + 1 : 1;
    return `${start}${String(Number.isFinite(seq) ? seq : 1).padStart(4, '0')}`;
  }

  async listInvoices(filter: { status?: InvoiceStatus; clientId?: string }) {
    const rows = await this.prisma.invoice.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.clientId ? { clientId: filter.clientId } : {}) },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
      take: 500,
    });
    return rows.map(invoiceView);
  }

  async getInvoice(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { client: { select: { id: true, name: true } } } });
    if (!inv) throw notFound('Invoice');
    return invoiceView(inv);
  }

  async updateInvoice(id: string, dto: { status?: InvoiceStatus; notes?: string | null }) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    const data: Prisma.InvoiceUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status && dto.status !== inv.status) {
      if (!TRANSITIONS[inv.status].includes(dto.status)) {
        throw new AppError('conflict', `An invoice can't go from ${inv.status} to ${dto.status}`, HttpStatus.CONFLICT);
      }
      data.status = dto.status;
      if (dto.status === 'issued' && !inv.issuedAt) {
        const s = await this.settings();
        data.issuedAt = new Date();
        data.dueAt = new Date(Date.now() + s.paymentTermsDays * 86_400_000);
      }
      data.paidAt = dto.status === 'paid' ? new Date() : null;
    }
    const updated = await this.prisma.invoice.update({
      where: { id },
      data,
      include: { client: { select: { id: true, name: true } } },
    });
    return invoiceView(updated);
  }

  async deleteInvoice(id: string): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'draft') {
      throw new AppError('conflict', 'Only draft invoices can be deleted. Void an issued one instead.', HttpStatus.CONFLICT);
    }
    await this.prisma.invoice.delete({ where: { id } });
  }

  // ───────────────────────── Unit costs (quote calculator) ─────────────────────────

  /** Real averages from recent client traffic, plus the marking profile's prices for estimates. */
  async unitCosts(days: number) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [calls, evals, drafts, marking, rubric] = await Promise.all([
      this.prisma.llmCall.groupBy({
        by: ['kind'],
        where: { origin: 'client', createdAt: { gte: from } },
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, cachedTokens: true, outputTokens: true },
      }),
      this.prisma.$queryRaw<{ completed: bigint; blank: bigint; reused: bigint; failed: bigint; adjusted: bigint; reviewed: bigint }[]>(Prisma.sql`
        SELECT
          count(*) FILTER (WHERE status = 'completed') AS completed,
          count(*) FILTER (WHERE status = 'completed' AND 'blank' = ANY(flags)) AS blank,
          count(*) FILTER (WHERE status = 'completed' AND "reusedFromId" IS NOT NULL) AS reused,
          count(*) FILTER (WHERE status = 'failed') AS failed,
          count(*) FILTER (WHERE decision = 'adjusted') AS adjusted,
          count(*) FILTER (WHERE decision IS NOT NULL) AS reviewed
        FROM "Evaluation" WHERE "completedAt" >= ${from}`),
      this.prisma.rubricDraft.aggregate({
        where: { origin: 'client', createdAt: { gte: from } },
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      this.profiles.forKind('marking'),
      this.profiles.forKind('rubric_draft'),
    ]);
    const okDrafts = await this.prisma.rubricDraft.count({ where: { origin: 'client', ok: true, createdAt: { gte: from } } });
    const kind = (k: string) => calls.find((c) => c.kind === k);
    const e = evals[0];
    const completed = Number(e?.completed ?? 0);
    const blank = Number(e?.blank ?? 0);
    const reused = Number(e?.reused ?? 0);
    const aiMarked = completed - blank - reused;
    const mk = kind('marking');
    const fb = kind('feedback_rewrite');
    const avg = (sum: number | null | undefined, n: number | undefined) => (n ? Number(sum ?? 0) / n : null);
    const markingCost = Number(mk?._sum.costUsd ?? 0);
    const feedbackCost = Number(fb?._sum.costUsd ?? 0);
    return {
      days,
      sample: { completed, aiMarked, blank, reused, failed: Number(e?.failed ?? 0), rubricDrafts: okDrafts },
      perMarkingCall: {
        calls: mk?._count._all ?? 0,
        inputTokens: avg(mk?._sum.inputTokens, mk?._count._all),
        cachedTokens: avg(mk?._sum.cachedTokens, mk?._count._all),
        outputTokens: avg(mk?._sum.outputTokens, mk?._count._all),
      },
      // Includes retries and failed calls, spread over the answers the AI actually marked.
      costPerAnswerUsd: aiMarked > 0 ? (markingCost + feedbackCost) / aiMarked : null,
      costPerRubricDraftUsd: okDrafts > 0 ? Number(drafts._sum.costUsd ?? 0) / okDrafts : null,
      blankShare: completed > 0 ? blank / completed : null,
      reuseShare: completed > 0 ? reused / completed : null,
      adjustRate: Number(e?.reviewed ?? 0) > 0 ? Number(e?.adjusted ?? 0) / Number(e?.reviewed) : null,
      promptBaseTokens: markingPromptBaseTokens(),
      markingProfile: { id: marking.id, name: marking.name, model: marking.model, prices: marking.prices },
      rubricProfile: { id: rubric.id, name: rubric.name, model: rubric.model, prices: rubric.prices },
    };
  }

  // ───────────────────────── CSV ─────────────────────────

  async statementsCsv(month?: string): Promise<string> {
    const s = await this.statements(month);
    const header = [
      'month', 'client', 'plan', 'currency', 'answers_completed', 'blank', 'reused', 'failed', 'billable_answers',
      'rubric_drafts', 'subtotal', 'tax', 'total', 'ai_cost_usd', 'ai_cost_in_currency', 'margin', 'margin_percent', 'invoice',
    ];
    const rows = s.rows.map((r) => [
      s.month, r.client.name, r.plan?.name ?? '', r.plan?.currency ?? '', r.usage.completed, r.usage.blank, r.usage.reused,
      r.usage.failed, r.charges?.billableAnswers ?? '', r.usage.rubricDrafts, r.charges?.subtotal ?? '', r.charges?.tax ?? '',
      r.charges?.total ?? '', r.usage.costUsd.toFixed(6), r.charges?.cost ?? '', r.charges?.margin ?? '',
      r.charges?.marginPercent ?? '', r.invoice?.number ?? '',
    ]);
    return toCsv([header, ...rows]);
  }

  async invoicesCsv(): Promise<string> {
    const list = await this.listInvoices({});
    const header = ['number', 'client', 'period_start', 'period_end', 'currency', 'subtotal', 'tax', 'total', 'ai_cost_usd', 'status', 'issued_at', 'due_at', 'paid_at'];
    const rows = list.map((i) => [
      i.number, i.clientName ?? '', i.periodStart, i.periodEnd, i.currency, i.subtotal, i.tax, i.total, i.costUsd,
      i.status, i.issuedAt ?? '', i.dueAt ?? '', i.paidAt ?? '',
    ]);
    return toCsv([header, ...rows]);
  }

}

function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    // Quote, and neutralise spreadsheet formulas in text cells.
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
