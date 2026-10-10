import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { DeferredMarkingProcessor, RealtimeMarkingProcessor, WebhookProcessor } from './queue/processors';

/** The queue consumers. Loaded by the worker process, and by the API when RUN_EMBEDDED_WORKERS=true. */
@Module({
  imports: [CoreModule],
  providers: [RealtimeMarkingProcessor, DeferredMarkingProcessor, WebhookProcessor],
})
export class WorkersModule {}
