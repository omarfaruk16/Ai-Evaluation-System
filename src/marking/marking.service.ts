import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LlmClient, LlmError } from '../llm/llm.types';
import { UsageService } from '../usage/usage.service';
import { WebhookService } from '../webhooks/webhook.service';
import { markingPrompt, PROMPT_VERSIONS } from './prompts';
import { markingJsonSchema, markingOutputSchema, rubricSchema } from './schemas';
import { buildMarkingResult } from './scoring';

/** Why a marking attempt didn't finish. The processor turns this into retry / rate-limit / give up. */
export class MarkingFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly rateLimitedMs?: number,
  ) {
    super(message);
    this.name = 'MarkingFailure';
  }
}

export type RunOutcome = 'completed' | 'failed' | 'skipped';

@Injectable()
export class MarkingService {
  private readonly logger = new Logger(MarkingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmClient) private readonly llm: LlmClient,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Marks one evaluation. Returns 'completed' or 'failed' when the evaluation reached a final
   * state, or throws MarkingFailure when the job should be retried (or paused for a rate limit).
   */
  async run(evaluationId: string, isFinalAttempt: boolean): Promise<RunOutcome> {
    const ev = await this.prisma.evaluation.findUnique({
      where: { id: evaluationId },
      include: { question: true, client: true },
    });
    if (!ev || ev.status === 'completed' || ev.status === 'failed') return 'skipped';

    await this.prisma.evaluation.update({
      where: { id: ev.id },
      data: { status: 'running', runCount: { increment: 1 } },
    });

    try {
      await this.usage.assertWithinBudget({
        id: ev.clientId,
        monthlyBudgetUsd: ev.client.monthlyBudgetUsd === null ? null : Number(ev.client.monthlyBudgetUsd),
      });

      const rubric = rubricSchema.parse(ev.question.rubric);
      const prompt = markingPrompt({
        question: ev.question.text,
        modelAnswer: ev.question.modelAnswer,
        maxMarks: ev.question.maxMarks,
        markStep: ev.question.markStep,
        rubric,
        answer: ev.answerText,
      });
      const promptVersion = PROMPT_VERSIONS.marking;

      let result;
      try {
        result = await this.llm.complete({
          kind: 'marking',
          system: prompt.system,
          user: prompt.user,
          schemaName: 'marking_result',
          jsonSchema: markingJsonSchema,
          context: { kind: 'marking', rubric, answer: ev.answerText, markStep: ev.question.markStep },
        });
      } catch (e) {
        if (e instanceof LlmError) {
          await this.usage.record({
            clientId: ev.clientId,
            evaluationId: ev.id,
            kind: 'marking',
            model: e.extra.model ?? this.llm.model,
            host: e.extra.host ?? null,
            promptVersion,
            usage: e.extra.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0 },
            latencyMs: e.extra.latencyMs ?? 0,
            ok: false,
            error: `${e.code}: ${e.message}`,
          });
          throw new MarkingFailure(
            e.message,
            e.retryable,
            e.code === 'rate_limited' ? (e.extra.retryAfterMs ?? 5_000) : undefined,
          );
        }
        throw e;
      }

      const parsed = markingOutputSchema.safeParse(result.data);
      await this.usage.record({
        clientId: ev.clientId,
        evaluationId: ev.id,
        kind: 'marking',
        model: result.model,
        host: result.host,
        promptVersion,
        usage: result.usage,
        latencyMs: result.latencyMs,
        ok: parsed.success,
        error: parsed.success ? undefined : 'output did not match the schema',
      });
      if (!parsed.success) throw new MarkingFailure('Model output did not match the schema', true);

      const res = buildMarkingResult({
        rubric,
        maxMarks: ev.question.maxMarks,
        markStep: ev.question.markStep,
        answer: ev.answerText,
        output: parsed.data,
        maxHighlights: this.env.MAX_HIGHLIGHTS,
      });

      // Only write if the answer wasn't resubmitted (or re-run) while this call was in flight.
      const written = await this.prisma.evaluation.updateMany({
        where: { id: ev.id, answerHash: ev.answerHash, status: 'running' },
        data: {
          status: 'completed',
          suggestedScore: res.suggestedScore,
          criteria: res.criteria as unknown as Prisma.InputJsonValue,
          summary: res.summary,
          strengths: res.strengths,
          weaknesses: res.weaknesses,
          highlights: res.highlights as unknown as Prisma.InputJsonValue,
          missing: res.missing as unknown as Prisma.InputJsonValue,
          studentFeedback: res.studentFeedback as unknown as Prisma.InputJsonValue,
          confidence: res.confidence,
          flags: res.flags,
          model: result.model,
          host: result.host,
          promptVersion,
          error: null,
          completedAt: new Date(),
        },
      });
      if (written.count === 0) return 'skipped';
      await this.webhooks.notify([ev.id], 'evaluation.completed');
      return 'completed';
    } catch (e) {
      const failure =
        e instanceof MarkingFailure
          ? e
          : e instanceof AppError && e.code === 'budget_exceeded'
            ? new MarkingFailure(e.message, false)
            : new MarkingFailure((e as Error).message ?? 'Unexpected error', true);

      const mine = { id: ev.id, answerHash: ev.answerHash, status: 'running' as const };
      if (failure.rateLimitedMs !== undefined || (failure.retryable && !isFinalAttempt)) {
        await this.prisma.evaluation.updateMany({
          where: mine,
          data: { status: 'queued', error: failure.message.slice(0, 1000) },
        });
        throw failure;
      }

      this.logger.warn(`Evaluation ${ev.id} failed: ${failure.message}`);
      const written = await this.prisma.evaluation.updateMany({
        where: mine,
        data: { status: 'failed', error: failure.message.slice(0, 1000), completedAt: new Date() },
      });
      if (written.count === 0) return 'skipped';
      await this.webhooks.notify([ev.id], 'evaluation.failed');
      return 'failed';
    }
  }
}
