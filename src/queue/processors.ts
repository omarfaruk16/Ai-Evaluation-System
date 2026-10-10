import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { envInt } from '../config/runtime';
import { MarkingFailure, MarkingService } from '../marking/marking.service';
import { WebhookService } from '../webhooks/webhook.service';
import { QUEUE_DEFERRED, QUEUE_REALTIME, QUEUE_WEBHOOKS, type MarkingJob, type WebhookJob } from './queue.module';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

async function runMarking(host: WorkerHost, marking: MarkingService, job: Job<MarkingJob>): Promise<string> {
  try {
    return await marking.run(job.data.evaluationId, isFinal(job));
  } catch (e) {
    if (e instanceof MarkingFailure) {
      if (e.rateLimitedMs !== undefined) {
        // Pause the whole queue (all replicas) for the provider's retry-after; doesn't use an attempt.
        await host.worker.rateLimit(e.rateLimitedMs);
        throw Worker.RateLimitError();
      }
      if (!e.retryable) throw new UnrecoverableError(e.message);
    }
    throw e;
  }
}

// Concurrency and rate limits are read at startup; the limiter is shared by every replica.
const rate = (maxVar: string, maxDefault: number) => ({
  max: envInt(maxVar, maxDefault),
  duration: envInt('RATE_DURATION_MS', 1_000),
});

@Processor(QUEUE_REALTIME, {
  concurrency: envInt('REALTIME_CONCURRENCY', 20),
  limiter: rate('REALTIME_RATE_MAX', 30),
})
export class RealtimeMarkingProcessor extends WorkerHost {
  constructor(@Inject(MarkingService) private readonly marking: MarkingService) {
    super();
  }

  process(job: Job<MarkingJob>): Promise<string> {
    return runMarking(this, this.marking, job);
  }
}

@Processor(QUEUE_DEFERRED, {
  concurrency: envInt('DEFERRED_CONCURRENCY', 10),
  limiter: rate('DEFERRED_RATE_MAX', 5),
})
export class DeferredMarkingProcessor extends WorkerHost {
  constructor(@Inject(MarkingService) private readonly marking: MarkingService) {
    super();
  }

  process(job: Job<MarkingJob>): Promise<string> {
    return runMarking(this, this.marking, job);
  }
}

@Processor(QUEUE_WEBHOOKS, { concurrency: 10 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(@Inject(WebhookService) private readonly webhooks: WebhookService) {
    super();
  }

  async process(job: Job<WebhookJob>): Promise<void> {
    try {
      await this.webhooks.deliver(job.data.deliveryId, isFinal(job));
    } catch (e) {
      if (isFinal(job)) this.logger.warn(`Webhook job ${job.id} exhausted: ${(e as Error).message}`);
      throw e;
    }
  }
}
