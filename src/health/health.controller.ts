import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { LlmClient } from '../llm/llm.types';
import { QUEUE_DEFERRED, QUEUE_REALTIME } from '../queue/queue.module';

/** Unauthenticated liveness/readiness check for load balancers and uptime monitors. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmClient) private readonly llm: LlmClient,
    @InjectQueue(QUEUE_REALTIME) private readonly realtime: Queue,
    @InjectQueue(QUEUE_DEFERRED) private readonly deferred: Queue,
  ) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => 'ok',
        () => 'down',
      ),
      this.realtime.client.then((c) => (c as unknown as { ping(): Promise<string> }).ping()).then(
        () => 'ok',
        () => 'down',
      ),
    ]);
    const queues =
      redis === 'ok'
        ? {
            realtime: await this.realtime.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed'),
            deferred: await this.deferred.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed'),
          }
        : null;
    const ok = db === 'ok' && redis === 'ok';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      db,
      redis,
      llm: { provider: this.llm.provider, model: this.llm.model },
      queues,
    });
  }
}
