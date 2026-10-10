import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { LlmCallKind } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import type { LlmUsage } from '../llm/llm.types';

const SPEND_CACHE_MS = 30_000;

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

@Injectable()
export class UsageService {
  private readonly spend = new Map<string, { at: number; usd: number }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Writes one row to the LLM call ledger. Called for failed calls too, since they can cost money. */
  async record(input: {
    clientId: string;
    evaluationId?: string;
    kind: LlmCallKind;
    model: string;
    host: string | null;
    promptVersion: string;
    usage: LlmUsage;
    latencyMs: number;
    ok: boolean;
    error?: string;
  }): Promise<void> {
    await this.prisma.llmCall.create({
      data: {
        clientId: input.clientId,
        evaluationId: input.evaluationId ?? null,
        kind: input.kind,
        model: input.model,
        host: input.host,
        promptVersion: input.promptVersion,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cachedTokens: input.usage.cachedTokens,
        reasoningTokens: input.usage.reasoningTokens,
        costUsd: input.usage.costUsd,
        latencyMs: Math.round(input.latencyMs),
        ok: input.ok,
        error: input.error?.slice(0, 1000) ?? null,
      },
    });
    const cached = this.spend.get(input.clientId);
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
      throw new AppError(
        'budget_exceeded',
        `Monthly AI budget of $${client.monthlyBudgetUsd} is used up ($${spent.toFixed(4)} spent). Marking continues by hand until next month or a higher budget.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async summary(clientId: string, from: Date, to: Date) {
    const where = { clientId, createdAt: { gte: from, lt: to } };
    const [byKind, evaluations] = await Promise.all([
      this.prisma.llmCall.groupBy({
        by: ['kind', 'ok'],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          reasoningTokens: true,
          costUsd: true,
        },
        _avg: { latencyMs: true },
      }),
      this.prisma.evaluation.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const calls = byKind.map((r) => ({
      kind: r.kind,
      ok: r.ok,
      count: r._count._all,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      cachedTokens: r._sum.cachedTokens ?? 0,
      reasoningTokens: r._sum.reasoningTokens ?? 0,
      costUsd: Number(r._sum.costUsd ?? 0),
      avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
    }));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalCostUsd: Number(calls.reduce((s, c) => s + c.costUsd, 0).toFixed(6)),
      calls,
      evaluations: Object.fromEntries(evaluations.map((e) => [e.status, e._count._all])),
    };
  }
}
