import { Body, Controller, Get, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { parseOrThrow } from '../common/validation';
import { ProfileService } from '../llm/profile.service';
import { RubricDraftService } from '../marking/rubric-draft.service';
import { rubricSchema } from '../marking/schemas';
import { TryMarkService } from '../marking/try-mark.service';
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
    @Inject(TryMarkService) private readonly tryMark: TryMarkService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(RubricDraftService) private readonly drafts: RubricDraftService,
  ) {}

  async mark(input: MarkInput) {
    return this.tryMark.mark(null, input);
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
