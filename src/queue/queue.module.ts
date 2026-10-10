import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export const QUEUE_REALTIME = 'marking-realtime';
export const QUEUE_DEFERRED = 'marking-deferred';
export const QUEUE_WEBHOOKS = 'webhooks';

export interface MarkingJob {
  evaluationId: string;
}

export interface WebhookJob {
  deliveryId: string;
}

/** Marking attempts per job before an evaluation is marked failed (rate limits don't count). */
export const MARKING_ATTEMPTS = 4;

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: redisConnection(env.REDIS_URL),
        defaultJobOptions: {
          attempts: MARKING_ATTEMPTS,
          backoff: { type: 'exponential', delay: env.MARKING_BACKOFF_MS },
          removeOnComplete: { age: 3_600, count: 5_000 },
          removeOnFail: { age: 7 * 24 * 3_600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_REALTIME }, { name: QUEUE_DEFERRED }, { name: QUEUE_WEBHOOKS }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
