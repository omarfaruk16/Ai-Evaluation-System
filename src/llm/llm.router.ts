import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ChatCompletionsClient } from './chat-completions.client';
import { LlmClient, LlmError, type AdapterResult, type LlmAdapter, type LlmRequest, type LlmResult, type LlmUsage } from './llm.types';
import { MockLlmClient } from './mock.client';
import { estimateCostUsd, type ResolvedProfile } from './profile';
import { ProfileService } from './profile.service';

/** Uses the provider's reported cost; prices the tokens from the profile when there is none. */
export function priceUsage(usage: LlmUsage, p: ResolvedProfile): { usage: LlmUsage; costEstimated: boolean } {
  if (usage.costUsd > 0 || usage.inputTokens + usage.outputTokens === 0) return { usage, costEstimated: false };
  return { usage: { ...usage, costUsd: Number(estimateCostUsd(usage, p.prices).toFixed(8)) }, costEstimated: true };
}

/**
 * The LlmClient the marking code uses. Each call goes to the model profile assigned to its task
 * (or the one the request names), through the adapter for that profile's provider.
 */
@Injectable()
export class LlmRouter extends LlmClient {
  private readonly adapters: Record<LlmProvider, LlmAdapter>;

  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
    const chat = new ChatCompletionsClient({ name: env.OPENROUTER_APP_NAME, url: env.OPENROUTER_APP_URL });
    this.adapters = { openrouter: chat, openai_compatible: chat, mock: new MockLlmClient() };
  }

  get provider(): string {
    return this.profiles.current('marking').provider;
  }

  get model(): string {
    return this.profiles.current('marking').model;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const profile = req.profileId ? await this.profiles.byId(req.profileId) : await this.profiles.forKind(req.kind);
    return this.completeWith(profile, req);
  }

  async completeWith(p: ResolvedProfile, req: LlmRequest): Promise<LlmResult> {
    if (p.provider === 'mock' && this.env.NODE_ENV === 'production') {
      throw new LlmError('The mock model is not allowed in production. Assign a real model profile.', 'invalid_request', false, {
        model: p.model,
        profileId: p.id,
      });
    }
    let res: AdapterResult;
    try {
      res = await this.adapters[p.provider].complete(p, req);
    } catch (e) {
      if (e instanceof LlmError) {
        e.extra.profileId = p.id;
        e.extra.model ??= p.model;
        if (e.extra.usage) {
          const priced = priceUsage(e.extra.usage, p);
          e.extra.usage = priced.usage;
          e.extra.costEstimated = priced.costEstimated;
        }
      }
      throw e;
    }
    const priced = priceUsage(res.usage, p);
    return { ...res, usage: priced.usage, profileId: p.id, costEstimated: priced.costEstimated };
  }
}
