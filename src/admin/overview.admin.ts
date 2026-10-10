import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Inject, Injectable, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ProfileService } from '../llm/profile.service';
import { QUEUE_DEFERRED, QUEUE_REALTIME, QUEUE_WEBHOOKS } from '../queue/queue.module';
import { AdminGuard } from './auth/admin.guard';
import { BillingService } from './billing/billing.service';
import { zoneOffsetMs } from './time';

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const ms = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v)));

@Injectable()
export class OverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @InjectQueue(QUEUE_REALTIME) private readonly realtime: Queue,
    @InjectQueue(QUEUE_DEFERRED) private readonly deferred: Queue,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly webhookQueue: Queue,
  ) {}

  async overview(days: number) {
    const { timeZone } = await this.billing.settings();
    const now = new Date();
    const from = new Date(now.getTime() - days * 86_400_000);
    const tz = Prisma.sql`${timeZone}`;

    const [totals, dailyEvals, dailyCost, byKind, byModel, latency, turnaround, agreement, byClient, pending, webhooks, statements] =
      await Promise.all([
        this.prisma.$queryRaw<{ completed: bigint; failed: bigint; blank: bigint; reused: bigint }[]>(Prisma.sql`
          SELECT count(*) FILTER (WHERE status = 'completed') AS completed,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 count(*) FILTER (WHERE status = 'completed' AND 'blank' = ANY(flags)) AS blank,
                 count(*) FILTER (WHERE status = 'completed' AND "reusedFromId" IS NOT NULL) AS reused
          FROM "Evaluation" WHERE "completedAt" >= ${from}`),
        this.prisma.$queryRaw<{ day: string; completed: bigint; failed: bigint }[]>(Prisma.sql`
          SELECT to_char(("completedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
                 count(*) FILTER (WHERE status = 'completed') AS completed,
                 count(*) FILTER (WHERE status = 'failed') AS failed
          FROM "Evaluation" WHERE "completedAt" >= ${from} GROUP BY 1`),
        this.prisma.$queryRaw<{ day: string; cost: Prisma.Decimal | null; calls: bigint }[]>(Prisma.sql`
          SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
                 sum("costUsd") AS cost, count(*) AS calls
          FROM "LlmCall" WHERE "createdAt" >= ${from} GROUP BY 1`),
        this.prisma.llmCall.groupBy({
          by: ['kind', 'origin'],
          where: { createdAt: { gte: from } },
          _count: { _all: true },
          _sum: { costUsd: true, inputTokens: true, outputTokens: true, cachedTokens: true },
        }),
        this.prisma.$queryRaw<
          { model: string; host: string | null; calls: bigint; failed: bigint; cost: Prisma.Decimal | null; estimated: bigint; avg_latency: number | null }[]
        >(Prisma.sql`
          SELECT model, host, count(*) AS calls, count(*) FILTER (WHERE NOT ok) AS failed, sum("costUsd") AS cost,
                 count(*) FILTER (WHERE "costEstimated") AS estimated, avg("latencyMs") FILTER (WHERE ok) AS avg_latency
          FROM "LlmCall" WHERE "createdAt" >= ${from}
          GROUP BY model, host ORDER BY calls DESC LIMIT 20`),
        this.prisma.$queryRaw<{ p50: number | null; p95: number | null }[]>(Prisma.sql`
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
          FROM "LlmCall" WHERE kind = 'marking' AND ok AND "createdAt" >= ${from}`),
        // Submit-to-suggestion time for answers the model actually marked.
        this.prisma.$queryRaw<{ lane: string; p50: number | null; p95: number | null; count: bigint }[]>(Prisma.sql`
          SELECT lane::text AS lane,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("completedAt" - "createdAt")) * 1000) AS p50,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM ("completedAt" - "createdAt")) * 1000) AS p95,
                 count(*) AS count
          FROM "Evaluation"
          WHERE status = 'completed' AND "completedAt" >= ${from} AND "reusedFromId" IS NULL AND NOT ('blank' = ANY(flags))
          GROUP BY lane`),
        this.prisma.$queryRaw<
          { accepted: bigint; adjusted: bigint; rejected: bigint; mean_abs: number | null; mean_abs_share: number | null }[]
        >(Prisma.sql`
          SELECT count(*) FILTER (WHERE decision = 'accepted') AS accepted,
                 count(*) FILTER (WHERE decision = 'adjusted') AS adjusted,
                 count(*) FILTER (WHERE decision = 'rejected') AS rejected,
                 avg(abs("finalScore" - "suggestedScore")) FILTER (WHERE decision IN ('accepted', 'adjusted')) AS mean_abs,
                 avg(abs("finalScore" - "suggestedScore") / NULLIF("maxMarks", 0)) FILTER (WHERE decision IN ('accepted', 'adjusted')) AS mean_abs_share
          FROM "Evaluation" WHERE "reviewedAt" >= ${from}`),
        this.prisma.$queryRaw<{ clientId: string; name: string; completed: bigint; cost: Prisma.Decimal | null }[]>(Prisma.sql`
          SELECT c.id AS "clientId", c.name,
                 (SELECT count(*) FROM "Evaluation" e WHERE e."clientId" = c.id AND e.status = 'completed' AND e."completedAt" >= ${from}) AS completed,
                 (SELECT sum(l."costUsd") FROM "LlmCall" l WHERE l."clientId" = c.id AND l."createdAt" >= ${from}) AS cost
          FROM "Client" c ORDER BY completed DESC, c.name LIMIT 20`),
        this.prisma.evaluation.groupBy({ by: ['status', 'lane'], where: { status: { in: ['queued', 'running'] } }, _count: { _all: true } }),
        this.prisma.webhookDelivery.groupBy({ by: ['status'], where: { status: { in: ['pending', 'failed'] } }, _count: { _all: true } }),
        this.billing.statements(),
      ]);

    // Fill every day of the range, in the business time zone.
    const evalByDay = new Map(dailyEvals.map((d) => [d.day, d]));
    const costByDay = new Map(dailyCost.map((d) => [d.day, d]));
    const daily = Array.from({ length: days }, (_, i) => {
      const t = new Date(now.getTime() - (days - 1 - i) * 86_400_000);
      const local = new Date(t.getTime() + zoneOffsetMs(t, timeZone));
      const day = local.toISOString().slice(0, 10);
      return {
        day,
        completed: n(evalByDay.get(day)?.completed),
        failed: n(evalByDay.get(day)?.failed),
        costUsd: Number(costByDay.get(day)?.cost ?? 0),
        calls: n(costByDay.get(day)?.calls),
      };
    });

    const t = totals[0];
    const a = agreement[0];
    const reviewed = n(a?.accepted) + n(a?.adjusted) + n(a?.rejected);
    const costUsd = byKind.reduce((s, k) => s + Number(k._sum.costUsd ?? 0), 0);
    const estimatedCalls = byModel.reduce((s, m) => s + n(m.estimated), 0);
    const totalCalls = byModel.reduce((s, m) => s + n(m.calls), 0);
    const [rt, df, wh] = await Promise.all([
      this.realtime.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'paused'),
      this.deferred.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'paused'),
      this.webhookQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    ]);
    const assigned = await Promise.all(
      (['marking', 'rubric_draft', 'feedback_rewrite'] as const).map(async (k) => {
        const p = await this.profiles.forKind(k);
        return [k, { id: p.id, name: p.name, provider: p.provider, model: p.model }] as const;
      }),
    );

    return {
      days,
      timeZone,
      totals: {
        completed: n(t?.completed),
        failed: n(t?.failed),
        blank: n(t?.blank),
        reused: n(t?.reused),
        costUsd: Number(costUsd.toFixed(6)),
        calls: totalCalls,
        estimatedCostShare: totalCalls > 0 ? estimatedCalls / totalCalls : 0,
      },
      latency: { p50Ms: ms(latency[0]?.p50), p95Ms: ms(latency[0]?.p95) },
      turnaround: turnaround.map((r) => ({ lane: r.lane, p50Ms: ms(r.p50), p95Ms: ms(r.p95), count: n(r.count) })),
      agreement: {
        reviewed,
        accepted: n(a?.accepted),
        adjusted: n(a?.adjusted),
        rejected: n(a?.rejected),
        acceptRate: reviewed > 0 ? n(a?.accepted) / reviewed : null,
        meanAbsDiff: a?.mean_abs === null || a?.mean_abs === undefined ? null : Number(a.mean_abs),
        meanAbsDiffShare: a?.mean_abs_share === null || a?.mean_abs_share === undefined ? null : Number(a.mean_abs_share),
      },
      daily,
      byKind: byKind.map((k) => ({
        kind: k.kind,
        origin: k.origin,
        calls: k._count._all,
        costUsd: Number(k._sum.costUsd ?? 0),
        inputTokens: k._sum.inputTokens ?? 0,
        outputTokens: k._sum.outputTokens ?? 0,
        cachedTokens: k._sum.cachedTokens ?? 0,
      })),
      byModel: byModel.map((m) => ({
        model: m.model,
        host: m.host,
        calls: n(m.calls),
        failed: n(m.failed),
        costUsd: Number(m.cost ?? 0),
        avgLatencyMs: ms(m.avg_latency),
      })),
      byClient: byClient.map((c) => ({ clientId: c.clientId, name: c.name, completed: n(c.completed), costUsd: Number(c.cost ?? 0) })),
      inFlight: pending.map((p) => ({ status: p.status, lane: p.lane, count: p._count._all })),
      queues: { realtime: rt, deferred: df, webhooks: wh },
      webhooks: Object.fromEntries(webhooks.map((w) => [w.status, w._count._all])),
      month: {
        month: statements.month,
        totals: statements.totals,
        costUsd: statements.costUsd,
        consoleCostUsd: statements.consoleCostUsd,
        fxRates: statements.fxRates,
      },
      models: Object.fromEntries(assigned),
    };
  }
}

@Controller('admin-api/overview')
@UseGuards(AdminGuard)
export class OverviewController {
  constructor(@Inject(OverviewService) private readonly overview: OverviewService) {}

  @Get()
  get(@Query('days') days?: string) {
    const d = [7, 14, 30, 90].includes(Number(days)) ? Number(days) : 30;
    return this.overview.overview(d);
  }
}
