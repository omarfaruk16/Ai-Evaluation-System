import { Body, Controller, Get, HttpStatus, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { canonicalAnswer, isBlankAnswer } from '../common/text';
import { parseOrThrow } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LlmRouter } from '../llm/llm.router';
import { LlmError } from '../llm/llm.types';
import { ProfileService } from '../llm/profile.service';
import { markingPrompt, PROMPT_VERSIONS } from '../marking/prompts';
import { validateRubric } from '../marking/rubric';
import { RubricDraftService } from '../marking/rubric-draft.service';
import { markingJsonSchema, markingOutputSchema, rubricSchema } from '../marking/schemas';
import { blankResult, buildMarkingResult } from '../marking/scoring';
import { errorFields, resultFields, UsageService } from '../usage/usage.service';
import { AdminGuard } from './auth/admin.guard';

const markSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  modelAnswer: z.string().trim().min(1).max(20_000),
  maxMarks: z.number().positive().max(1000),
  markStep: z.number().positive().max(100).default(0.5),
  rubric: rubricSchema,
  answer: z.string().max(20_000),
  profileId: z.string().uuid().optional(),
});
const draftSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  modelAnswer: z.string().trim().min(1).max(20_000),
  maxMarks: z.number().positive().max(1000),
  markStep: z.number().positive().max(100).default(0.5),
  maxCriteria: z.number().int().min(1).max(12).default(6),
  profileId: z.string().uuid().optional(),
});

export type MarkInput = z.infer<typeof markSchema>;

export const SAMPLE = {
  question: 'Explain how TCP provides reliable data transfer over an unreliable network.',
  modelAnswer:
    'TCP numbers every byte with sequence numbers so the receiver can reorder segments and detect gaps. The receiver sends cumulative acknowledgements. If an acknowledgement does not arrive before the retransmission timeout, the sender retransmits the segment; three duplicate acknowledgements trigger fast retransmit. A checksum detects corrupted segments, which are discarded. Flow control uses a sliding window advertised by the receiver.',
  maxMarks: 6,
  markStep: 0.5,
  rubric: {
    criteria: [
      { id: 'c1', criterion: 'Sequence numbers and ACKs', marks: 2, awardWhen: 'Sequence numbers (1); acknowledgements (1)' },
      { id: 'c2', criterion: 'Retransmission', marks: 2, awardWhen: 'Timeout resend (1); duplicate ACKs / fast retransmit (1)' },
      { id: 'c3', criterion: 'Checksum', marks: 1, awardWhen: 'Detects corrupted segments' },
      { id: 'c4', criterion: 'Flow control', marks: 1, awardWhen: 'Sliding / receive window' },
    ],
  },
  answer:
    'TCP gives each byte a sequence number and the receiver sends ACKs back, so lost data can be found. When the timer runs out without an ACK the sender sends the segment again. It also has a checksum for errors.',
};

/** Marks one answer or drafts one rubric with any model profile. Costs go to the ledger as console calls. */
@Injectable()
export class PlaygroundService {
  constructor(
    @Inject(LlmRouter) private readonly router: LlmRouter,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(RubricDraftService) private readonly drafts: RubricDraftService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async mark(input: MarkInput) {
    const issues = validateRubric(input.rubric, input.maxMarks, input.markStep);
    if (issues.length > 0) {
      throw new AppError('invalid_rubric', 'The rubric does not fit the question', HttpStatus.UNPROCESSABLE_ENTITY, issues);
    }
    const profile = input.profileId ? await this.profiles.byId(input.profileId) : await this.profiles.forKind('marking');
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
    const base = { clientId: null, origin: 'console' as const, kind: 'marking' as const, promptVersion: PROMPT_VERSIONS.marking };
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

  async draftRubric(input: z.infer<typeof draftSchema>) {
    const started = Date.now();
    const profile = input.profileId ? await this.profiles.byId(input.profileId) : await this.profiles.forKind('rubric_draft');
    try {
      const draft = await this.drafts.draft(null, input, { profileId: profile.id ?? undefined, origin: 'console' });
      return { ok: true as const, profile: { id: profile.id, name: profile.name, model: profile.model }, latencyMs: Date.now() - started, ...draft };
    } catch (e) {
      if (e instanceof AppError) {
        const body = e.getResponse() as { error: { message: string; details?: unknown } };
        return { ok: false as const, profile: { id: profile.id, name: profile.name, model: profile.model }, latencyMs: Date.now() - started, error: body.error.message, details: body.error.details ?? null };
      }
      throw e;
    }
  }
}

@Controller('admin-api/playground')
@UseGuards(AdminGuard)
export class PlaygroundController {
  constructor(@Inject(PlaygroundService) private readonly playground: PlaygroundService) {}

  @Get('sample')
  sample() {
    return SAMPLE;
  }

  @Post('mark')
  mark(@Body() body: unknown) {
    return this.playground.mark(parseOrThrow(markSchema, body));
  }

  @Post('draft-rubric')
  draftRubric(@Body() body: unknown) {
    return this.playground.draftRubric(parseOrThrow(draftSchema, body));
  }
}
