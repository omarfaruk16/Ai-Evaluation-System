import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, CurrentClient, type AuthenticatedClient } from '../auth/api-key.guard';
import { parseOrThrow } from '../common/validation';
import { usageQuerySchema } from '../evaluations/evaluations.dto';
import { UsageService } from './usage.service';

@Controller('v1/usage')
@UseGuards(ApiKeyGuard)
export class UsageController {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}

  /** Tokens, cost and evaluation counts for the calling client. Defaults to the current month. */
  @Get()
  async get(@CurrentClient() client: AuthenticatedClient, @Query() query: unknown) {
    const q = parseOrThrow(usageQuerySchema, query);
    const now = new Date();
    const from = q.from ? new Date(q.from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = q.to ? new Date(q.to) : now;
    const [summary, spent] = await Promise.all([
      this.usage.summary(client.id, from, to),
      this.usage.spentThisMonth(client.id),
    ]);
    return {
      ...summary,
      budget: { monthlyBudgetUsd: client.monthlyBudgetUsd, spentThisMonthUsd: Number(spent.toFixed(6)) },
    };
  }
}
