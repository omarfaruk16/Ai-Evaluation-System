import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CallOrigin, LlmCallKind } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { emptyUsage, type LlmError, type LlmResult, type LlmUsage } from '../llm/llm.types';

const SPEND_CACHE_MS = 30_000;

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export interface CallRecord {
  clientId: string | null;
  origin?: CallOrigin;
  evaluationId?: string;
  /** For calls without an evaluation: the project's grouping, for its cost breakdown. */
  groupId?: string;
  kind: LlmCallKind;
  profileId?: string | null;
  model: string;
  host: string | null;
  promptVersion: string;
  usage: LlmUsage;
  costEstimated?: boolean;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

/** Ledger fields for a call that returned (its output may still fail validation). */
export const resultFields = (r: LlmResult) => ({
  profileId: r.profileId,
  model: r.model,
  host: r.host,
  usage: r.usage,
  costEstimated: r.costEstimated,
  latencyMs: r.latencyMs,
});

/** Ledger fields for a call that failed. Failed calls can still cost money. */
export const errorFields = (e: LlmError, fallbackModel: string) => ({
  profileId: e.extra.profileId ?? null,
  model: e.extra.model ?? fallbackModel,
  host: e.extra.host ?? null,
  usage: e.extra.usage ?? emptyUsage(),
  costEstimated: e.extra.costEstimated ?? false,
  latencyMs: e.extra.latencyMs ?? 0,
  ok: false,
  error: `${e.code}: ${e.message}`,
});

@Injectable()
export class UsageService {
  private readonly spend = new Map<string, { at: number; usd: number }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Writes one row to the LLM call ledger. Called for failed calls too, since they can cost money. */
  async record(input: CallRecord): Promise<void> {
    await this.prisma.llmCall.create({
      data: {
        clientId: input.clientId,
        origin: input.origin ?? 'client',
        evaluationId: input.evaluationId ?? null,
        groupId: input.groupId ?? null,
        kind: input.kind,
        profileId: input.profileId ?? null,
        model: input.model,
        host: input.host,
        promptVersion: input.promptVersion,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cachedTokens: input.usage.cachedTokens,
        reasoningTokens: input.usage.reasoningTokens,
        costUsd: input.usage.costUsd,
        costEstimated: input.costEstimated ?? false,
        latencyMs: Math.round(input.latencyMs),
        ok: input.ok,
        error: input.error?.slice(0, 1000) ?? null,
      },
    });
    const cached = input.clientId ? this.spend.get(input.clientId) : undefined;
    if (cached) cached.usd += input.usage.costUsd;
  }

  async spentThisMonth(clientId: string): Promise<number> {
    const cached = this.spend.get(clientId);
    if (cached && Date.now() - cached.at < SPEND_CACHE_MS) return cached.usd;
    const agg = await this.prisma.llmCall.aggregate({
      where: { clientId, createdAt: { gte: monthStart() } },
      _sum: { costUsd: true },
    });
    const usd = Number(agg._sum.costUsd ?? 0);
    this.spend.set(clientId, { at: Date.now(), usd });
    return usd;
  }

  /** Throws 402 when the client has a monthly budget and has used it up. */
  async assertWithinBudget(client: { id: string; monthlyBudgetUsd: number | null }): Promise<void> {
    if (client.monthlyBudgetUsd === null) return;
    const spent = await this.spentThisMonth(client.id);
    if (spent >= client.monthlyBudgetUsd) {
      // Projects are customers: tell them the limit is reached, never what the AI cost you.
      throw new AppError(
        'budget_exceeded',
        "This project's monthly AI usage limit is reached. Marking continues by hand until next month or until the limit is raised.",
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * What a project used, without costs or token counts (projects are customers; your AI cost
   * and margin stay in the console). Answers count by when they were submitted.
   */
  async projectUsage(client: { id: string; monthlyBudgetUsd: number | null }, from: Date, to: Date) {
    const where = { clientId: client.id, createdAt: { gte: from, lt: to } };
    const [byStatus, blank, reused, drafts, spent] = await Promise.all([
      this.prisma.evaluation.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.evaluation.count({ where: { ...where, status: 'completed', flags: { has: 'blank' } } }),
      this.prisma.evaluation.count({ where: { ...where, status: 'completed', reusedFromId: { not: null } } }),
      this.prisma.rubricDraft.count({ where: { ...where, origin: 'client', ok: true } }),
      client.monthlyBudgetUsd === null ? Promise.resolve(0) : this.spentThisMonth(client.id),
    ]);
    const status = { queued: 0, running: 0, completed: 0, failed: 0 };
    for (const r of byStatus) status[r.status] = r._count._all;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      answers: { ...status, blank, reused },
      rubricDrafts: drafts,
      usageLimit: {
        set: client.monthlyBudgetUsd !== null,
        reached: client.monthlyBudgetUsd !== null && spent >= client.monthlyBudgetUsd,
      },
    };
  }
}
