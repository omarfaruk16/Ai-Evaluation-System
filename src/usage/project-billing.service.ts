import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allocateCharges, billableAnswers, computeCharges, type GroupUsage } from '../admin/billing/billing.calc';
import { BILLING_DEFAULTS, BILLING_KEY, billingSettingsSchema, type BillingSettings } from '../admin/billing/billing.settings';
import { currentMonth, monthPeriod, shiftMonth } from '../admin/time';
import { planTerms } from '../admin/views';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../settings/settings.service';

const MAX_MONTHS = 36;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const emptyGroup = (groupId: string | null): GroupUsage => ({
  groupId,
  completed: 0,
  blank: 0,
  reused: 0,
  failed: 0,
  rubricDrafts: 0,
  costUsd: 0,
});

/**
 * What a project is charged, month by month and split by its own groups (the `groupId` it sent
 * with evaluations, rubric drafts and trial marks), priced with its plan. Shows the project its
 * prices, never what the AI cost you: no AI cost, markup or margin.
 */
@Injectable()
export class ProjectBillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settingsStore: SettingsService,
  ) {}

  private async settings(): Promise<BillingSettings> {
    const parsed = billingSettingsSchema.safeParse(await this.settingsStore.get(BILLING_KEY, BILLING_DEFAULTS));
    return parsed.success ? parsed.data : BILLING_DEFAULTS;
  }

  async billing(clientId: string, query: { from?: string; to?: string }) {
    const settings = await this.settings();
    const tz = settings.timeZone;
    const to = query.to ?? currentMonth(tz);
    const from = query.from ?? shiftMonth(to, -11);
    if (!MONTH.test(from) || !MONTH.test(to) || from > to) {
      throw new AppError('validation_failed', 'from and to must be months like 2026-10, from ≤ to', HttpStatus.BAD_REQUEST);
    }
    const months: string[] = [];
    for (let m = from; m <= to; m = shiftMonth(m, 1)) {
      months.push(m);
      if (months.length > MAX_MONTHS) {
        throw new AppError('validation_failed', `At most ${MAX_MONTHS} months at a time`, HttpStatus.BAD_REQUEST);
      }
    }
    const start = monthPeriod(from, tz).start;
    const end = monthPeriod(to, tz).end;

    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: { plan: true } });
    const local = (col: Prisma.Sql) => Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM')`;
    const [evals, drafts, costs, invoices] = await Promise.all([
      this.prisma.$queryRaw<
        { month: string; groupId: string | null; completed: bigint; blank: bigint; reused: bigint; failed: bigint }[]
      >(Prisma.sql`
        SELECT ${local(Prisma.sql`"completedAt"`)} AS month, "groupId",
          count(*) FILTER (WHERE status = 'completed') AS completed,
          count(*) FILTER (WHERE status = 'completed' AND 'blank' = ANY(flags)) AS blank,
          count(*) FILTER (WHERE status = 'completed' AND "reusedFromId" IS NOT NULL) AS reused,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM "Evaluation"
        WHERE "clientId" = ${clientId} AND "completedAt" >= ${start} AND "completedAt" < ${end}
        GROUP BY 1, 2`),
      this.prisma.$queryRaw<{ month: string; groupId: string | null; n: bigint }[]>(Prisma.sql`
        SELECT ${local(Prisma.sql`"createdAt"`)} AS month, "groupId", count(*) AS n
        FROM "RubricDraft"
        WHERE "clientId" = ${clientId} AND origin = 'client' AND ok AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY 1, 2`),
      // Only used to split a cost-plus charge between groups; never returned.
      this.prisma.$queryRaw<{ month: string; groupId: string | null; usd: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT ${local(Prisma.sql`l."createdAt"`)} AS month, COALESCE(l."groupId", e."groupId") AS "groupId",
          sum(l."costUsd") AS usd
        FROM "LlmCall" l LEFT JOIN "Evaluation" e ON e.id = l."evaluationId"
        WHERE l."clientId" = ${clientId} AND l.origin = 'client' AND l."createdAt" >= ${start} AND l."createdAt" < ${end}
        GROUP BY 1, 2`),
      this.prisma.invoice.findMany({
        where: { clientId, periodStart: { gte: start, lt: end }, status: { not: 'void' } },
        select: { number: true, status: true, total: true, periodStart: true },
      }),
    ]);

    const byMonth = new Map<string, Map<string | null, GroupUsage>>(months.map((m) => [m, new Map()]));
    const group = (month: string, groupId: string | null) => {
      const m = byMonth.get(month);
      if (!m) return null;
      let g = m.get(groupId);
      if (!g) m.set(groupId, (g = emptyGroup(groupId)));
      return g;
    };
    for (const r of evals) {
      const g = group(r.month, r.groupId);
      if (!g) continue;
      g.completed += Number(r.completed);
      g.blank += Number(r.blank);
      g.reused += Number(r.reused);
      g.failed += Number(r.failed);
    }
    for (const r of drafts) {
      const g = group(r.month, r.groupId);
      if (g) g.rubricDrafts += Number(r.n);
    }
    for (const r of costs) {
      const g = group(r.month, r.groupId);
      if (g) g.costUsd += Number(r.usd ?? 0);
    }

    const terms = client.plan ? planTerms(client.plan) : null;
    // Per-answer prices don't depend on the exchange rate; cost-plus charges do.
    const fx = terms ? (settings.fxRates[terms.currency] ?? (terms.billingModel === 'per_answer' ? 1 : null)) : null;
    const invoiceFor = (periodStart: Date) => {
      const inv = invoices.find((i) => i.periodStart.getTime() === periodStart.getTime());
      return inv ? { number: inv.number, status: inv.status, total: Number(inv.total) } : null;
    };

    return {
      timeZone: tz,
      currency: terms?.currency ?? settings.defaultCurrency,
      plan: client.plan
        ? {
            name: client.plan.name,
            billingModel: client.plan.billingModel,
            monthlyFee: Number(client.plan.monthlyFee),
            includedAnswers: client.plan.includedAnswers,
            pricePerAnswer: Number(client.plan.pricePerAnswer),
            pricePerRubricDraft: Number(client.plan.pricePerRubricDraft),
            chargeBlank: client.plan.chargeBlank,
            chargeReused: client.plan.chargeReused,
            taxPercent: Number(client.plan.taxPercent),
          }
        : null,
      months: months.map((month) => {
        const period = monthPeriod(month, tz);
        const groups = [...byMonth.get(month)!.values()];
        const total = groups.reduce((s, g) => {
          for (const k of ['completed', 'blank', 'reused', 'failed', 'rubricDrafts', 'costUsd'] as const) s[k] += g[k];
          return s;
        }, emptyGroup(null));
        // A project is billed from the month it was created.
        const billed = terms && fx !== null && client.createdAt < period.end;
        const charges = billed ? computeCharges(total, terms, fx) : null;
        return {
          month,
          answers: { completed: total.completed, blank: total.blank, reused: total.reused, failed: total.failed },
          rubricDrafts: total.rubricDrafts,
          charges: charges
            ? {
                billableAnswers: charges.billableAnswers,
                lines: charges.lines,
                subtotal: charges.subtotal,
                tax: charges.tax,
                total: charges.total,
              }
            : null,
          groups: charges
            ? allocateCharges(charges, terms!, groups)
            : groups.map((g) => ({
                groupId: g.groupId,
                billableAnswers: terms ? billableAnswers(g, terms) : g.completed,
                failed: g.failed,
                rubricDrafts: g.rubricDrafts,
                subtotal: 0,
                total: 0,
              })),
          invoice: invoiceFor(period.start),
        };
      }),
    };
  }
}
