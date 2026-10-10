import { Global, Logger, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LlmClient } from './llm.types';
import { MockLlmClient } from './mock.client';
import { OpenRouterClient } from './openrouter.client';

export function createLlmClient(env: Env): LlmClient {
  return env.LLM_PROVIDER === 'openrouter' ? new OpenRouterClient(env) : new MockLlmClient(env);
}

@Global()
@Module({
  providers: [
    {
      provide: LlmClient,
      inject: [ENV],
      useFactory: (env: Env) => {
        const client = createLlmClient(env);
        new Logger('LlmModule').log(`LLM provider: ${client.provider} (${client.model})`);
        return client;
      },
    },
  ],
  exports: [LlmClient],
})
export class LlmModule {}
