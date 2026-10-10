import { Global, Module } from '@nestjs/common';
import { LlmRouter } from './llm.router';
import { LlmClient } from './llm.types';
import { ProfileService } from './profile.service';

@Global()
@Module({
  providers: [ProfileService, LlmRouter, { provide: LlmClient, useExisting: LlmRouter }],
  exports: [ProfileService, LlmRouter, LlmClient],
})
export class LlmModule {}
