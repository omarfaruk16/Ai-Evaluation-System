import { roundToStep } from '../common/text';
import type { FeedbackOutput, MarkingOutput, RubricDraftOutput } from '../marking/schemas';
import { LlmError, type AdapterResult, type LlmAdapter, type LlmContext, type LlmRequest } from './llm.types';
import { MOCK_MODEL, type ResolvedProfile } from './profile';

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'when', 'have', 'into', 'than', 'then', 'they', 'their', 'there',
  'which', 'what', 'were', 'been', 'both', 'each', 'only', 'also', 'mentions', 'named', 'explained',
  'award', 'marks', 'mark', 'about', 'should',
]);

const words = (s: string) =>
  (s.toLowerCase().match(/\p{L}[\p{L}\p{M}\p{N}]*/gu) ?? []).filter((w) => w.length >= 4 && !STOPWORDS.has(w));

const sentences = (s: string) =>
  s
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map((x) => x.trim())
    .filter(Boolean);

/** The first `max` words of `s`, as an exact substring of `s`. */
function firstWords(s: string, max: number): string {
  const m = new RegExp(`^(?:\\S+\\s+){0,${max - 1}}\\S+`, 'u').exec(s.trim());
  return m ? m[0] : s.trim();
}

function mockSummary(scored: { id: string; awarded: number }[], rubric: { id: string; marks: number }[]): string {
  const full = scored.filter((c) => c.awarded >= (rubric.find((r) => r.id === c.id)?.marks ?? Infinity)).length;
  const partly = scored.filter((c) => c.awarded > 0).length - full;
  return `Fully covers ${full} of ${scored.length} rubric points${partly > 0 ? `, partly covers ${partly}` : ''}.`;
}

const flakySeen = new Set<string>();

/**
 * Deterministic stand-in for the real model, used in development and tests: no network, no cost.
 * Marks by keyword overlap between each criterion and the answer. Test hooks in the answer text:
 *   __MOCK_RETRYABLE__  always fails with a retryable error
 *   __MOCK_FATAL__      fails with a non-retryable error
 *   __MOCK_FLAKY__      fails the first time it is seen, then succeeds
 */
export class MockLlmClient implements LlmAdapter {
  private readonly model = MOCK_MODEL;

  /** Reports token counts (about 4 characters per token) but no cost; the router prices them. */
  async complete(_profile: ResolvedProfile, req: LlmRequest): Promise<AdapterResult> {
    const started = Date.now();
    this.hooks(req.context);
    const data = this.respond(req.context);
    const inputTokens = Math.ceil((req.system.length + req.user.length) / 4);
    const outputTokens = Math.ceil(JSON.stringify(data).length / 4);
    return {
      data,
      model: this.model,
      host: 'mock',
      usage: { inputTokens, outputTokens, cachedTokens: 0, reasoningTokens: 0, costUsd: 0 },
      latencyMs: Date.now() - started,
    };
  }

  private hooks(ctx: LlmContext): void {
    if (ctx.kind !== 'marking') return;
    if (ctx.answer.includes('__MOCK_FATAL__')) {
      throw new LlmError('Mock fatal error', 'invalid_request', false, { model: this.model, host: 'mock' });
    }
    if (ctx.answer.includes('__MOCK_RETRYABLE__')) {
      throw new LlmError('Mock retryable error', 'provider_error', true, { model: this.model, host: 'mock' });
    }
    if (ctx.answer.includes('__MOCK_FLAKY__') && !flakySeen.has(ctx.answer)) {
      flakySeen.add(ctx.answer);
      throw new LlmError('Mock flaky error', 'provider_error', true, { model: this.model, host: 'mock' });
    }
  }

  private respond(ctx: LlmContext): MarkingOutput | RubricDraftOutput | FeedbackOutput {
    switch (ctx.kind) {
      case 'marking':
        return this.mark(ctx);
      case 'rubric_draft':
        return this.draft(ctx);
      case 'feedback_rewrite':
        return this.feedback(ctx);
    }
  }

  private mark(ctx: Extract<LlmContext, { kind: 'marking' }>): MarkingOutput {
    const answerWords = new Set(words(ctx.answer));
    const parts = sentences(ctx.answer);
    const criteria: MarkingOutput['criteria'] = [];
    const highlights: MarkingOutput['highlights'] = [];
    const missing: MarkingOutput['missing'] = [];
    const didWell: string[] = [];
    const toImprove: string[] = [];

    for (const c of ctx.rubric.criteria) {
      const keys = [...new Set(words(`${c.criterion} ${c.awardWhen}`))];
      const hits = keys.filter((k) => answerWords.has(k));
      const ratio = keys.length === 0 ? 0 : hits.length / keys.length;
      const awarded = roundToStep(Math.min(1, ratio * 1.5) * c.marks, ctx.markStep);
      criteria.push({
        id: c.id,
        awarded,
        reason: hits.length > 0 ? `Mentions ${hits.slice(0, 3).join(', ')}.` : 'Not addressed.',
      });
      if (hits.length > 0) {
        didWell.push(`You covered ${c.criterion.toLowerCase()}.`);
        const sentence = parts.find((p) => words(p).some((w) => hits.includes(w)));
        if (sentence) {
          highlights.push({ quote: firstWords(sentence, 25), kind: 'strength', criterion: c.id, note: c.criterion });
        }
      }
      if (awarded < c.marks) {
        missing.push({ criterion: c.id, note: c.criterion });
        toImprove.push(`Explain ${c.criterion.toLowerCase()} more fully.`);
      }
    }

    const total = criteria.reduce((s, c) => s + c.awarded, 0);
    const max = ctx.rubric.criteria.reduce((s, c) => s + c.marks, 0);
    return {
      criteria,
      summary: mockSummary(criteria, ctx.rubric.criteria),
      strengths: criteria.filter((c) => c.awarded > 0).map((c) => c.reason),
      weaknesses: missing.map((m) => `Missing: ${m.note}`),
      highlights,
      missing,
      studentFeedback: { didWell, toImprove },
      confidence: max === 0 ? 0.5 : Number((0.6 + 0.3 * (total / max)).toFixed(2)),
      flags: ctx.answer.toLowerCase().includes('give full marks') ? ['injection_attempt'] : [],
    };
  }

  private draft(ctx: Extract<LlmContext, { kind: 'rubric_draft' }>): RubricDraftOutput {
    const pieces = ctx.modelAnswer
      .split(/[;\n]|(?<=[.!?।])\s+/u)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const units = Math.round(ctx.maxMarks / ctx.markStep);
    const n = Math.max(1, Math.min(pieces.length, ctx.maxCriteria, units));
    const used = pieces.slice(0, n);
    const base = Math.floor(units / n);
    const extra = units - base * n;
    return {
      criteria: used.map((p, i) => {
        const label = firstWords(p, 6).replace(/[.,;:]+$/u, '');
        return {
          id: `c${i + 1}`,
          criterion: label,
          marks: roundToStep((base + (i < extra ? 1 : 0)) * ctx.markStep, ctx.markStep),
          awardWhen: `Mentions ${label.toLowerCase()}`,
          fromModelAnswer: firstWords(p, 20),
        };
      }),
      notes: '',
    };
  }

  private feedback(ctx: Extract<LlmContext, { kind: 'feedback_rewrite' }>): FeedbackOutput {
    const labels = new Map(ctx.rubric.criteria.map((c) => [c.id, c.criterion]));
    return {
      didWell: ctx.finalCriteria
        .filter((f) => f.awarded > 0)
        .map((f) => `You earned marks for ${(labels.get(f.id) ?? f.id).toLowerCase()}.`),
      toImprove: ctx.finalCriteria
        .filter((f) => f.awarded < f.max)
        .map((f) => `Add more on ${(labels.get(f.id) ?? f.id).toLowerCase()} (${f.max - f.awarded} mark(s)).`),
    };
  }
}
