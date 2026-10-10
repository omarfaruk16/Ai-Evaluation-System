import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedClient } from '../auth/api-key.guard';
import { AppError } from '../common/errors';
import { canonicalAnswer, isBlankAnswer } from '../common/text';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LlmRouter } from '../llm/llm.router';
import { LlmError } from '../llm/llm.types';
import { ProfileService } from '../llm/profile.service';
import { errorFields, resultFields, UsageService } from '../usage/usage.service';
import { markingPrompt, PROMPT_VERSIONS } from './prompts';
import { validateRubric } from './rubric';
import { markingJsonSchema, markingOutputSchema, type Rubric } from './schemas';
import { blankResult, buildMarkingResult } from './scoring';

export interface TryMarkInput {
  question: string;
  modelAnswer: string;
  maxMarks: number;
  markStep: number;
  rubric: Rubric;
  answer: string;
  /** Console only: mark with this model profile instead of the one assigned to marking. */
  profileId?: string;
}

/**
 * Marks one answer straight away, without storing an evaluation: the console playground and a
 * project's "try this rubric" both use it. The call goes to the usage ledger like any other.
 */
@Injectable()
export class TryMarkService {
  constructor(
    @Inject(LlmRouter) private readonly router: LlmRouter,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async mark(client: AuthenticatedClient | null, input: TryMarkInput) {
    const issues = validateRubric(input.rubric, input.maxMarks, input.markStep);
    if (issues.length > 0) {
      throw new AppError('invalid_rubric', 'The rubric does not fit the question', HttpStatus.UNPROCESSABLE_ENTITY, issues);
    }
    if (client) await this.usage.assertWithinBudget(client);
    const profile =
      input.profileId && !client ? await this.profiles.byId(input.profileId) : await this.profiles.forKind('marking');
    const answer = canonicalAnswer(input.answer);
    // Highlight offsets refer to this exact (normalised) answer text.
    const meta = {
      profile: { id: profile.id, name: profile.name, provider: profile.provider, model: profile.model },
      answer,
      maxMarks: input.maxMarks,
    };
    if (isBlankAnswer(answer)) {
      return { ok: true as const, ...meta, result: blankResult(input.rubric), note: 'Blank answers get 0 without calling the model.' };
    }

    const prompt = markingPrompt({ ...input, answer });
    const base = {
      clientId: client?.id ?? null,
      origin: client ? ('client' as const) : ('console' as const),
      kind: 'marking' as const,
      promptVersion: PROMPT_VERSIONS.marking,
    };
    let result;
    try {
      result = await this.router.completeWith(profile, {
        kind: 'marking',
        system: prompt.system,
        user: prompt.user,
        schemaName: 'marking_result',
        jsonSchema: markingJsonSchema,
        context: { kind: 'marking', rubric: input.rubric, answer, markStep: input.markStep },
      });
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      await this.usage.record({ ...base, ...errorFields(e, profile.model) });
      return { ok: false as const, ...meta, error: `${e.code}: ${e.message}`, latencyMs: e.extra.latencyMs ?? null };
    }

    const parsed = markingOutputSchema.safeParse(result.data);
    await this.usage.record({
      ...base,
      ...resultFields(result),
      ok: parsed.success,
      error: parsed.success ? undefined : 'output did not match the schema',
    });
    const call = {
      model: result.model,
      host: result.host,
      usage: result.usage,
      costEstimated: result.costEstimated,
      latencyMs: result.latencyMs,
      promptVersion: PROMPT_VERSIONS.marking,
    };
    if (!parsed.success) {
      return { ok: false as const, ...meta, ...call, error: 'Model output did not match the schema', raw: result.data };
    }
    return {
      ok: true as const,
      ...meta,
      ...call,
      result: buildMarkingResult({
        rubric: input.rubric,
        maxMarks: input.maxMarks,
        markStep: input.markStep,
        answer,
        output: parsed.data,
        maxHighlights: this.env.MAX_HIGHLIGHTS,
      }),
      raw: parsed.data,
      prompt,
    };
  }
}
