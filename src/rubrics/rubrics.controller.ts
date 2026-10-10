import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, CurrentClient, type AuthenticatedClient } from '../auth/api-key.guard';
import { parseOrThrow } from '../common/validation';
import { rubricDraftSchema } from '../evaluations/evaluations.dto';
import { RubricDraftService } from '../marking/rubric-draft.service';

@Controller('v1/rubrics')
@UseGuards(ApiKeyGuard)
export class RubricsController {
  constructor(@Inject(RubricDraftService) private readonly drafts: RubricDraftService) {}

  /** Synchronous: returns a rubric draft for the teacher to approve or edit (a few seconds). */
  @Post('draft')
  @HttpCode(200)
  draft(@CurrentClient() client: AuthenticatedClient, @Body() body: unknown) {
    return this.drafts.draft(client, parseOrThrow(rubricDraftSchema, body));
  }
}
