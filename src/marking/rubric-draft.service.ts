import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { roundToStep } from '../common/text';
import type { AuthenticatedClient } from '../auth/api-key.guard';
import { LlmClient, LlmError, emptyUsage, type LlmUsage } from '../llm/llm.types';
import { UsageService } from '../usage/usage.service';
import { PROMPT_VERSIONS, rubricDraftPrompt } from './prompts';
import { rubricHash, validateRubricDraft, type Issue } from './rubric';
import { rubricDraftJsonSchema, rubricDraftOutputSchema, type Rubric, type RubricDraftOutput } from './schemas';

export interface RubricDraftInput {
  question: string;
  modelAnswer: string;
  maxMarks: number;
  markStep: number;
  maxCriteria: number;
}

const ATTEMPTS = 2;

@Injectable()
export class RubricDraftService {
  constructor(
    @Inject(LlmClient) private readonly llm: LlmClient,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  /**
   * Drafts a rubric from the model answer. A draft whose marks don't add up, or whose criteria
   * don't trace to the model answer, is retried once with the problems listed; if it still
   * fails, the caller gets 422 with the issues and the last draft.
   */
  async draft(client: AuthenticatedClient, input: RubricDraftInput) {
    await this.usage.assertWithinBudget(client);
    const total: LlmUsage = emptyUsage();
    let issues: Issue[] = [];
    let last: RubricDraftOutput | null = null;
    let model = this.llm.model;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const prompt = rubricDraftPrompt({ ...input, previousIssues: issues.map((i) => `${i.path}: ${i.message}`) });
      let result;
      try {
        result = await this.llm.complete({
          kind: 'rubric_draft',
          system: prompt.system,
          user: prompt.user,
          schemaName: 'rubric_draft',
          jsonSchema: rubricDraftJsonSchema,
          maxOutputTokens: 1_500,
          context: {
            kind: 'rubric_draft',
            modelAnswer: input.modelAnswer,
            maxMarks: input.maxMarks,
            markStep: input.markStep,
            maxCriteria: input.maxCriteria,
          },
        });
      } catch (e) {
        if (e instanceof LlmError) {
          await this.usage.record({
            clientId: client.id,
            kind: 'rubric_draft',
            model: e.extra.model ?? this.llm.model,
            host: e.extra.host ?? null,
            promptVersion: PROMPT_VERSIONS.rubric_draft,
            usage: e.extra.usage ?? emptyUsage(),
            latencyMs: e.extra.latencyMs ?? 0,
            ok: false,
            error: `${e.code}: ${e.message}`,
          });
          throw new AppError(
            'llm_unavailable',
            `The AI model is unavailable right now (${e.code}). Try again shortly.`,
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        throw e;
      }

      model = result.model;
      for (const k of Object.keys(total) as (keyof LlmUsage)[]) total[k] += result.usage[k];
      const parsed = rubricDraftOutputSchema.safeParse(result.data);
      await this.usage.record({
        clientId: client.id,
        kind: 'rubric_draft',
        model: result.model,
        host: result.host,
        promptVersion: PROMPT_VERSIONS.rubric_draft,
        usage: result.usage,
        latencyMs: result.latencyMs,
        ok: parsed.success,
        error: parsed.success ? undefined : 'output did not match the schema',
      });
      if (!parsed.success) {
        issues = [{ path: '', message: 'output did not match the JSON schema' }];
        continue;
      }
      const draft: RubricDraftOutput = {
        ...parsed.data,
        criteria: parsed.data.criteria.map((c) => ({ ...c, marks: roundToStep(c.marks, input.markStep) })),
      };
      last = draft;
      issues = validateRubricDraft(draft, input.modelAnswer, input.maxMarks, input.markStep, input.maxCriteria);
      if (issues.length === 0) return this.response(draft, model, total);
    }

    throw new AppError(
      'rubric_draft_invalid',
      'The AI could not produce a valid rubric for this question. Write it by hand or try again.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { issues, draft: last },
    );
  }

  private response(draft: RubricDraftOutput, model: string, usage: LlmUsage) {
    const rubric: Rubric = {
      criteria: draft.criteria.map((c, i) => ({
        id: `c${i + 1}`,
        criterion: c.criterion.trim(),
        marks: c.marks,
        awardWhen: c.awardWhen.trim(),
      })),
    };
    return {
      rubric,
      rubricHash: rubricHash(rubric),
      sources: draft.criteria.map((c, i) => ({ criterionId: `c${i + 1}`, fromModelAnswer: c.fromModelAnswer })),
      notes: draft.notes.trim(),
      model,
      promptVersion: PROMPT_VERSIONS.rubric_draft,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: Number(usage.costUsd.toFixed(6)),
      },
    };
  }
}
