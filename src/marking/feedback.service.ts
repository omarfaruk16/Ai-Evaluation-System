import { Inject, Injectable } from '@nestjs/common';
import { LlmClient, LlmError } from '../llm/llm.types';
import { errorFields, resultFields, UsageService } from '../usage/usage.service';
import { feedbackPrompt, PROMPT_VERSIONS } from './prompts';
import { feedbackJsonSchema, feedbackOutputSchema, type Rubric, type StudentFeedback } from './schemas';

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(LlmClient) private readonly llm: LlmClient,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  /** Rewrites student feedback so it matches the teacher's final marks. Returns null on failure. */
  async rewrite(input: {
    clientId: string;
    evaluationId: string;
    question: string;
    modelAnswer: string;
    rubric: Rubric;
    answer: string;
    finalCriteria: { id: string; awarded: number; max: number }[];
    teacherNote?: string;
  }): Promise<{ feedback: StudentFeedback | null; error?: string }> {
    const prompt = feedbackPrompt(input);
    try {
      const result = await this.llm.complete({
        kind: 'feedback_rewrite',
        system: prompt.system,
        user: prompt.user,
        schemaName: 'student_feedback',
        jsonSchema: feedbackJsonSchema,
        maxOutputTokens: 800,
        context: { kind: 'feedback_rewrite', rubric: input.rubric, finalCriteria: input.finalCriteria },
      });
      const parsed = feedbackOutputSchema.safeParse(result.data);
      await this.usage.record({
        clientId: input.clientId,
        evaluationId: input.evaluationId,
        kind: 'feedback_rewrite',
        promptVersion: PROMPT_VERSIONS.feedback_rewrite,
        ...resultFields(result),
        ok: parsed.success,
        error: parsed.success ? undefined : 'output did not match the schema',
      });
      if (!parsed.success) return { feedback: null, error: 'Model output did not match the schema' };
      const clean = (xs: string[], n: number) => xs.map((s) => s.trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, 400));
      return { feedback: { didWell: clean(parsed.data.didWell, 6), toImprove: clean(parsed.data.toImprove, 8) } };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      await this.usage.record({
        clientId: input.clientId,
        evaluationId: input.evaluationId,
        kind: 'feedback_rewrite',
        promptVersion: PROMPT_VERSIONS.feedback_rewrite,
        ...errorFields(e, this.llm.model),
      });
      return { feedback: null, error: `AI unavailable (${e.code})` };
    }
  }
}
