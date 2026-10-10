import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parseOrThrow } from '../common/validation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { toView } from '../evaluations/evaluation.view';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { PROMPT_VERSIONS } from '../marking/prompts';
import { QUEUE_DEFERRED, QUEUE_REALTIME, QUEUE_WEBHOOKS } from '../queue/queue.module';
import { AdminGuard } from './auth/admin.guard';
import { paged, pageQuery, UuidPipe } from './http';
import { llmCallView, webhookView } from './views';

const evaluationQuery = pageQuery.extend({
  clientId: z.string().uuid().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  lane: z.enum(['realtime', 'deferred']).optional(),
  decision: z.enum(['accepted', 'adjusted', 'rejected', 'none']).optional(),
  flag: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  q: z.string().trim().max(200).optional(),
});

/** Re-runs an evaluation the way its client would (resets it to queued and enqueues a new job). */
async function rerunAsClient(prisma: PrismaService, evaluations: EvaluationsService, id: string) {
  const ev = await prisma.evaluation.findUnique({ where: { id }, include: { client: true } });
  if (!ev) throw notFound('Evaluation');
  const c = ev.client;
  return evaluations.rerun(
    { id: c.id, name: c.name, webhookUrl: c.webhookUrl, monthlyBudgetUsd: c.monthlyBudgetUsd === null ? null : Number(c.monthlyBudgetUsd) },
    id,
  );
}

@Controller('admin-api/evaluations')
@UseGuards(AdminGuard)
export class EvaluationsAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EvaluationsService) private readonly evaluations: EvaluationsService,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = parseOrThrow(evaluationQuery, query);
    const where: Prisma.EvaluationWhereInput = {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.lane ? { lane: q.lane } : {}),
      ...(q.decision ? { decision: q.decision === 'none' ? null : q.decision } : {}),
      ...(q.flag ? { flags: { has: q.flag } } : {}),
      ...(q.q
        ? {
            OR: [
              { externalId: { contains: q.q, mode: 'insensitive' } },
              { groupId: { contains: q.q, mode: 'insensitive' } },
              ...(/^[0-9a-f-]{36}$/i.test(q.q) ? [{ id: q.q }] : []),
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.evaluation.count({ where }),
      this.prisma.evaluation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          externalId: true,
          groupId: true,
          status: true,
          lane: true,
          suggestedScore: true,
          maxMarks: true,
          confidence: true,
          flags: true,
          decision: true,
          finalScore: true,
          model: true,
          error: true,
          reusedFromId: true,
          createdAt: true,
          completedAt: true,
          client: { select: { id: true, name: true } },
          question: { select: { text: true } },
        },
      }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      question: r.question.text.slice(0, 140),
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
    return paged(items, total, q.page, q.pageSize);
  }

  @Get(':id')
  async detail(@Param('id', new UuidPipe()) id: string) {
    const ev = await this.prisma.evaluation.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } }, question: true },
    });
    if (!ev) throw notFound('Evaluation');
    const [calls, webhooks] = await Promise.all([
      this.prisma.llmCall.findMany({ where: { evaluationId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.webhookDelivery.findMany({ where: { evaluationId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      evaluation: toView(ev),
      client: ev.client,
      question: {
        id: ev.question.id,
        externalId: ev.question.externalId,
        text: ev.question.text,
        modelAnswer: ev.question.modelAnswer,
        maxMarks: ev.question.maxMarks,
        markStep: ev.question.markStep,
        rubric: ev.question.rubric,
      },
      calls: calls.map(llmCallView),
      webhooks: webhooks.map(webhookView),
      costUsd: calls.reduce((s, c) => s + Number(c.costUsd), 0),
    };
  }

  /** Marks the answer again (same as a client re-run). Clears any teacher review. */
  @Post(':id/rerun')
  rerun(@Param('id', new UuidPipe()) id: string) {
    return rerunAsClient(this.prisma, this.evaluations, id);
  }
}

const webhookQuery = pageQuery.extend({
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
  clientId: z.string().uuid().optional(),
});

@Controller('admin-api/webhooks')
@UseGuards(AdminGuard)
export class WebhooksAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUE_WEBHOOKS) private readonly queue: Queue,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = parseOrThrow(webhookQuery, query);
    const where: Prisma.WebhookDeliveryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.findMany({
        where,
        include: { client: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paged(rows.map(webhookView), total, q.page, q.pageSize);
  }

  @Post(':id/retry')
  async retry(@Param('id', new UuidPipe()) id: string) {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!d) throw notFound('Webhook delivery');
    if (d.status === 'delivered') throw new AppError('conflict', 'This webhook was already delivered', HttpStatus.CONFLICT);
    const updated = await this.prisma.webhookDelivery.update({ where: { id }, data: { status: 'pending', lastError: null } });
    await this.queue.add(
      'deliver',
      { deliveryId: id },
      { jobId: `wh-${id}-${Date.now()}`, attempts: this.env.WEBHOOK_MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 10_000 } },
    );
    return webhookView(updated);
  }
}

const QUEUE_NAMES = { realtime: QUEUE_REALTIME, deferred: QUEUE_DEFERRED, webhooks: QUEUE_WEBHOOKS } as const;
type QueueKey = keyof typeof QUEUE_NAMES;

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

@Controller('admin-api/system')
@UseGuards(AdminGuard)
export class SystemController {
  private readonly queues: Record<QueueKey, Queue>;
  private readonly version = packageVersion();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EvaluationsService) private readonly evaluations: EvaluationsService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUE_REALTIME) realtime: Queue,
    @InjectQueue(QUEUE_DEFERRED) deferred: Queue,
    @InjectQueue(QUEUE_WEBHOOKS) webhooks: Queue,
  ) {
    this.queues = { realtime, deferred, webhooks };
  }

  private queue(name: string): Queue {
    const q = this.queues[name as QueueKey];
    if (!q) throw notFound('Queue');
    return q;
  }

  @Get()
  async status() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(
      () => 'ok',
      () => 'down',
    );
    const queues = await Promise.all(
      (Object.keys(this.queues) as QueueKey[]).map(async (key) => {
        const q = this.queues[key];
        const [counts, paused, workers] = await Promise.all([
          q.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'completed'),
          q.isPaused(),
          q.getWorkersCount().catch(() => null),
        ]);
        return { key, name: q.name, counts, paused, workers };
      }),
    );
    const e = this.env;
    return {
      version: this.version,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      db,
      redis: 'ok',
      queues,
      promptVersions: PROMPT_VERSIONS,
      config: {
        nodeEnv: e.NODE_ENV,
        embeddedWorkers: e.RUN_EMBEDDED_WORKERS,
        realtime: { concurrency: e.REALTIME_CONCURRENCY, ratePerWindow: e.REALTIME_RATE_MAX },
        deferred: { concurrency: e.DEFERRED_CONCURRENCY, ratePerWindow: e.DEFERRED_RATE_MAX },
        rateWindowMs: e.RATE_DURATION_MS,
        retryBackoffMs: e.MARKING_BACKOFF_MS,
        router: {
          firstNRealtime: e.ROUTER_FIRST_N_REALTIME,
          smallGroupMax: e.ROUTER_SMALL_GROUP_MAX,
          realtimeMaxWaiting: e.ROUTER_REALTIME_MAX_WAITING,
        },
        limits: { answersPerRequest: e.MAX_ANSWERS_PER_REQUEST, answerChars: e.MAX_ANSWER_CHARS, highlights: e.MAX_HIGHLIGHTS },
        webhooks: { timeoutMs: e.WEBHOOK_TIMEOUT_MS, maxAttempts: e.WEBHOOK_MAX_ATTEMPTS },
        adminSessionHours: e.ADMIN_SESSION_HOURS,
      },
    };
  }

  @Get('queues/:queue/failed')
  async failed(@Param('queue') name: string) {
    const jobs = await this.queue(name).getFailed(0, 49);
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
      finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
    }));
  }

  /**
   * Webhook jobs are retried as they are. A failed marking job is retried by re-running its
   * evaluation (already marked failed, so the old job would just skip it).
   */
  @Post('queues/:queue/failed/:jobId/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retryJob(@Param('queue') name: string, @Param('jobId') jobId: string) {
    const job = await this.queue(name).getJob(jobId);
    if (!job) throw notFound('Job');
    if (name === 'webhooks') {
      const deliveryId = (job.data as { deliveryId?: string }).deliveryId;
      if (deliveryId) await this.prisma.webhookDelivery.updateMany({ where: { id: deliveryId, status: 'failed' }, data: { status: 'pending' } });
      await job.retry('failed');
      return;
    }
    const evaluationId = (job.data as { evaluationId?: string }).evaluationId;
    if (!evaluationId) throw new AppError('validation_failed', 'This job has no evaluation', HttpStatus.BAD_REQUEST);
    await rerunAsClient(this.prisma, this.evaluations, evaluationId);
    await job.remove();
  }

  @Delete('queues/:queue/failed/:jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeJob(@Param('queue') name: string, @Param('jobId') jobId: string) {
    const job = await this.queue(name).getJob(jobId);
    if (!job) throw notFound('Job');
    await job.remove();
  }

  /** Stops workers in every process from taking new jobs (running jobs finish). */
  @Post('queues/:queue/pause')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pause(@Param('queue') name: string) {
    await this.queue(name).pause();
  }

  @Post('queues/:queue/resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resume(@Param('queue') name: string) {
    await this.queue(name).resume();
  }
}
