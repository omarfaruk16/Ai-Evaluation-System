import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, CurrentClient, type AuthenticatedClient } from '../auth/api-key.guard';
import { parseOrThrow } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { TryMarkService } from '../marking/try-mark.service';
import { listEvaluationsSchema, reviewSchema, submitEvaluationsSchema, tryMarkSchema } from './evaluations.dto';
import { EvaluationsService } from './evaluations.service';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class EvaluationsController {
  private readonly submitSchema;

  constructor(
    @Inject(EvaluationsService) private readonly evaluations: EvaluationsService,
    @Inject(TryMarkService) private readonly tryMark: TryMarkService,
    @Inject(ENV) env: Env,
  ) {
    this.submitSchema = submitEvaluationsSchema(env);
  }

  /** Submit one question (with its rubric) and up to MAX_ANSWERS_PER_REQUEST answers to mark. */
  @Post('evaluations')
  @HttpCode(202)
  submit(@CurrentClient() client: AuthenticatedClient, @Body() body: unknown) {
    return this.evaluations.submit(client, parseOrThrow(this.submitSchema, body));
  }

  /**
   * Synchronous: marks one sample answer against a rubric and returns the result (a few seconds).
   * Nothing is stored, so teachers can check a rubric before an exam uses it.
   */
  @Post('evaluations/try')
  @HttpCode(200)
  async try(@CurrentClient() client: AuthenticatedClient, @Body() body: unknown) {
    const r = await this.tryMark.mark(client, parseOrThrow(tryMarkSchema, body));
    // Model, host, usage and cost stay internal (projects don't see the provider or our margin).
    return {
      ok: r.ok,
      answer: r.answer,
      maxMarks: r.maxMarks,
      result: 'result' in r ? r.result : null,
      note: 'note' in r ? r.note : null,
      error: 'error' in r ? r.error : null,
      latencyMs: 'latencyMs' in r ? r.latencyMs : null,
    };
  }

  @Get('evaluations')
  list(@CurrentClient() client: AuthenticatedClient, @Query() query: unknown) {
    return this.evaluations.list(client, parseOrThrow(listEvaluationsSchema, query));
  }

  @Get('evaluations/:id')
  get(@CurrentClient() client: AuthenticatedClient, @Param('id') id: string) {
    return this.evaluations.get(client, id);
  }

  @Post('evaluations/:id/rerun')
  @HttpCode(202)
  rerun(@CurrentClient() client: AuthenticatedClient, @Param('id') id: string) {
    return this.evaluations.rerun(client, id);
  }

  /** Report the teacher's decision (accepted, adjusted marks or rejected). */
  @Post('evaluations/:id/review')
  @HttpCode(200)
  review(@CurrentClient() client: AuthenticatedClient, @Param('id') id: string, @Body() body: unknown) {
    return this.evaluations.review(client, id, parseOrThrow(reviewSchema, body));
  }

  @Get('groups/:groupId/progress')
  progress(@CurrentClient() client: AuthenticatedClient, @Param('groupId') groupId: string) {
    return this.evaluations.progress(client, groupId);
  }
}
