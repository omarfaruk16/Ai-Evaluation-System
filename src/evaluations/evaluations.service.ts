import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Evaluation, type Lane } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedClient } from '../auth/api-key.guard';
import { AppError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { canonicalAnswer, isBlankAnswer, sha256 } from '../common/text';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { questionContentHash, rubricHash, validateRubric } from '../marking/rubric';
import { chooseLane } from '../marking/router';
import { rubricSchema } from '../marking/schemas';
import { applyFinalCriteria, blankResult, type MarkingResult } from '../marking/scoring';
import { QUEUE_DEFERRED, QUEUE_REALTIME, type MarkingJob } from '../queue/queue.module';
import { UsageService } from '../usage/usage.service';
import { WebhookService } from '../webhooks/webhook.service';
import type { ListEvaluationsDto, ReviewDto, SubmitEvaluationsDto } from './evaluations.dto';
import { toView } from './evaluation.view';

const json = (v: unknown) => v as Prisma.InputJsonValue;

const resultData = (r: MarkingResult) => ({
  suggestedScore: r.suggestedScore,
  criteria: json(r.criteria),
  summary: r.summary,
  strengths: r.strengths,
  weaknesses: r.weaknesses,
  highlights: json(r.highlights),
  missing: json(r.missing),
  confidence: r.confidence,
  flags: r.flags,
});

const resetResult = (): Prisma.EvaluationUncheckedUpdateInput => ({
  suggestedScore: null,
  criteria: Prisma.DbNull,
  summary: null,
  strengths: [],
  weaknesses: [],
  highlights: Prisma.DbNull,
  missing: Prisma.DbNull,
  studentFeedback: Prisma.DbNull,
  confidence: null,
  flags: [],
  model: null,
  host: null,
  promptVersion: null,
  error: null,
  reusedFromId: null,
  completedAt: null,
  decision: null,
  finalScore: null,
  finalCriteria: Prisma.DbNull,
  finalFeedback: Prisma.DbNull,
  reviewedAt: null,
});

@Injectable()
export class EvaluationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUE_REALTIME) private readonly realtime: Queue<MarkingJob>,
    @InjectQueue(QUEUE_DEFERRED) private readonly deferred: Queue<MarkingJob>,
  ) {}

  // ───────────────────────── Submit ─────────────────────────

  async submit(client: AuthenticatedClient, dto: SubmitEvaluationsDto) {
    const q = dto.question;
    const issues = validateRubric(q.rubric, q.maxMarks, q.markStep);
    if (issues.length > 0) {
      throw new AppError('invalid_rubric', 'The rubric does not fit the question', HttpStatus.UNPROCESSABLE_ENTITY, issues);
    }
    const seen = new Set<string>();
    for (const a of dto.answers) {
      if (seen.has(a.externalId)) {
        throw new AppError('validation_failed', `Duplicate answer externalId "${a.externalId}" in one request`, HttpStatus.BAD_REQUEST);
      }
      seen.add(a.externalId);
    }
    await this.usage.assertWithinBudget(client);

    const question = await this.upsertQuestion(client.id, q);
    const answers = dto.answers.map((a) => {
      const text = canonicalAnswer(a.text);
      return { externalId: a.externalId, text, hash: sha256(text) };
    });

    const [existing, beforeInQuestion, groupBefore, reusable, realtimeWaiting] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: { clientId: client.id, questionId: question.id, externalId: { in: answers.map((a) => a.externalId) } },
      }),
      this.prisma.evaluation.count({ where: { questionId: question.id } }),
      dto.groupId ? this.prisma.evaluation.count({ where: { clientId: client.id, groupId: dto.groupId } }) : 0,
      this.prisma.evaluation.findMany({
        where: {
          questionId: question.id,
          status: 'completed',
          reusedFromId: null,
          answerHash: { in: [...new Set(answers.map((a) => a.hash))] },
        },
        distinct: ['answerHash'],
        orderBy: { completedAt: 'desc' },
      }),
      this.waitingCount(this.realtime),
    ]);
    const existingById = new Map(existing.map((e) => [e.externalId, e]));
    const reuseByHash = new Map(reusable.map((e) => [e.answerHash, e]));
    const rubric = rubricSchema.parse(question.rubric);

    const creates: Prisma.EvaluationCreateManyInput[] = [];
    const updates: { id: string; data: Prisma.EvaluationUncheckedUpdateInput }[] = [];
    const jobs: { id: string; lane: Lane; jobId: string }[] = [];
    const finished: { completed: string[]; failed: string[] } = { completed: [], failed: [] };
    const out: { id: string; externalId: string; status: string; lane: Lane; reused: boolean }[] = [];
    let newIndex = 0;

    for (const a of answers) {
      const prev = existingById.get(a.externalId);
      if (prev && prev.answerHash === a.hash) {
        out.push({ id: prev.id, externalId: a.externalId, status: prev.status, lane: prev.lane, reused: prev.reusedFromId !== null });
        continue;
      }

      const id = prev?.id ?? randomUUID();
      const base = {
        groupId: dto.groupId ?? null,
        answerText: a.text,
        answerHash: a.hash,
        callbackUrl: dto.callbackUrl ?? null,
        maxMarks: q.maxMarks,
      };
      let lane: Lane = 'realtime';
      let row: Record<string, unknown>;
      let status: 'queued' | 'completed' | 'failed';
      const source = reuseByHash.get(a.hash);

      if (isBlankAnswer(a.text)) {
        status = 'completed';
        row = { ...resultData(blankResult(rubric)), status, completedAt: new Date(), promptVersion: null };
      } else if (a.text.length > this.env.MAX_ANSWER_CHARS) {
        status = 'failed';
        row = {
          status,
          flags: ['too_long'],
          error: `Answer is ${a.text.length} characters; the limit for AI marking is ${this.env.MAX_ANSWER_CHARS}. Mark it by hand.`,
          completedAt: new Date(),
        };
      } else if (source) {
        status = 'completed';
        row = {
          status,
          suggestedScore: source.suggestedScore,
          criteria: json(source.criteria),
          summary: source.summary,
          strengths: source.strengths,
          weaknesses: source.weaknesses,
          highlights: json(source.highlights),
          missing: json(source.missing),
          confidence: source.confidence,
          flags: source.flags,
          model: source.model,
          host: source.host,
          promptVersion: source.promptVersion,
          reusedFromId: source.id,
          completedAt: new Date(),
        };
      } else {
        status = 'queued';
        lane = chooseLane(
          {
            requested: dto.lane,
            positionInQuestion: beforeInQuestion + newIndex,
            groupSize: groupBefore + answers.length,
            realtimeWaiting,
          },
          {
            firstNRealtime: this.env.ROUTER_FIRST_N_REALTIME,
            smallGroupMax: this.env.ROUTER_SMALL_GROUP_MAX,
            realtimeMaxWaiting: this.env.ROUTER_REALTIME_MAX_WAITING,
          },
        );
        row = { status };
        jobs.push({ id, lane, jobId: prev ? `eval-${id}-${Date.now()}` : `eval-${id}-0` });
      }
      newIndex++;

      if (prev) {
        updates.push({ id, data: { ...resetResult(), ...base, ...row, lane } as Prisma.EvaluationUncheckedUpdateInput });
      } else {
        creates.push({
          id,
          clientId: client.id,
          questionId: question.id,
          externalId: a.externalId,
          lane,
          ...base,
          ...row,
        } as Prisma.EvaluationCreateManyInput);
      }
      if (status === 'completed') finished.completed.push(id);
      if (status === 'failed') finished.failed.push(id);
      out.push({ id, externalId: a.externalId, status, lane, reused: Boolean(source) && status === 'completed' && !isBlankAnswer(a.text) });
    }

    try {
      await this.prisma.$transaction([
        ...(creates.length > 0 ? [this.prisma.evaluation.createMany({ data: creates })] : []),
        ...updates.map((u) => this.prisma.evaluation.update({ where: { id: u.id }, data: u.data })),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(
          'conflict',
          'Another request submitted some of these answers at the same time. Retry this request.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }

    await this.enqueue(jobs);
    await this.webhooks.notify(finished.completed, 'evaluation.completed');
    await this.webhooks.notify(finished.failed, 'evaluation.failed');

    return { questionId: question.id, groupId: dto.groupId ?? null, evaluations: out };
  }

  private async upsertQuestion(clientId: string, q: SubmitEvaluationsDto['question']) {
    const contentHash = questionContentHash(q);
    const data = {
      clientId,
      contentHash,
      externalId: q.externalId ?? null,
      text: q.text,
      modelAnswer: q.modelAnswer,
      maxMarks: q.maxMarks,
      markStep: q.markStep,
      rubric: json(q.rubric),
      rubricHash: rubricHash(q.rubric),
    };
    try {
      return await this.prisma.questionContext.upsert({
        where: { clientId_contentHash: { clientId, contentHash } },
        create: data,
        update: {},
      });
    } catch (e) {
      // Two requests creating the same question at once: the loser reads the winner's row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.questionContext.findUniqueOrThrow({
          where: { clientId_contentHash: { clientId, contentHash } },
        });
      }
      throw e;
    }
  }

  private async waitingCount(queue: Queue): Promise<number> {
    const counts = await queue.getJobCounts('waiting', 'prioritized', 'delayed');
    return (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0);
  }

  private async enqueue(jobs: { id: string; lane: Lane; jobId: string }[]): Promise<void> {
    const toBulk = (lane: Lane) =>
      jobs
        .filter((j) => j.lane === lane)
        .map((j) => ({ name: 'mark', data: { evaluationId: j.id }, opts: { jobId: j.jobId } }));
    const realtime = toBulk('realtime');
    const deferred = toBulk('deferred');
    if (realtime.length > 0) await this.realtime.addBulk(realtime);
    if (deferred.length > 0) await this.deferred.addBulk(deferred);
  }

  // ───────────────────────── Read ─────────────────────────

  async get(client: AuthenticatedClient, id: string) {
    return toView(await this.load(client, id));
  }

  private async load(client: AuthenticatedClient, id: string): Promise<Evaluation> {
    const ev = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.evaluation.findFirst({ where: { id, clientId: client.id } })
      : null;
    if (!ev) throw notFound('Evaluation');
    return ev;
  }

  /** Keyset-paged list, oldest change first, so a client can sync with `updatedSince` + `cursor`. */
  async list(client: AuthenticatedClient, q: ListEvaluationsDto) {
    let after: { updatedAt: Date; id: string } | null = null;
    if (q.cursor) {
      try {
        const [ts, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
        if (!ts || !id) throw new Error('bad cursor');
        after = { updatedAt: new Date(ts), id };
      } catch {
        throw new AppError('validation_failed', 'Invalid cursor', HttpStatus.BAD_REQUEST);
      }
    }
    const where: Prisma.EvaluationWhereInput = {
      clientId: client.id,
      ...(q.groupId ? { groupId: q.groupId } : {}),
      ...(q.questionId ? { questionId: q.questionId } : {}),
      ...(q.externalId ? { externalId: q.externalId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.updatedSince ? { updatedAt: { gte: new Date(q.updatedSince) } } : {}),
      ...(after
        ? {
            OR: [
              { updatedAt: { gt: after.updatedAt } },
              { updatedAt: after.updatedAt, id: { gt: after.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.evaluation.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(toView),
      nextCursor:
        rows.length > q.limit && last
          ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`, 'utf8').toString('base64url')
          : null,
    };
  }

  async progress(client: AuthenticatedClient, groupId: string) {
    const [byStatus, byLane, reviewed] = await Promise.all([
      this.prisma.evaluation.groupBy({ by: ['status'], where: { clientId: client.id, groupId }, _count: { _all: true } }),
      this.prisma.evaluation.groupBy({ by: ['lane'], where: { clientId: client.id, groupId }, _count: { _all: true } }),
      this.prisma.evaluation.count({ where: { clientId: client.id, groupId, decision: { not: null } } }),
    ]);
    const status = { queued: 0, running: 0, completed: 0, failed: 0 };
    for (const r of byStatus) status[r.status] = r._count._all;
    const lanes = { realtime: 0, deferred: 0 };
    for (const r of byLane) lanes[r.lane] = r._count._all;
    const total = Object.values(status).reduce((s, n) => s + n, 0);
    return { groupId, total, status, lanes, reviewed, done: total > 0 && status.queued + status.running === 0 };
  }

  // ───────────────────────── Actions ─────────────────────────

  async rerun(client: AuthenticatedClient, id: string) {
    const ev = await this.load(client, id);
    if (ev.status === 'queued' || ev.status === 'running') {
      throw new AppError('conflict', 'This evaluation is already being marked', HttpStatus.CONFLICT);
    }
    await this.usage.assertWithinBudget(client);
    const updated = await this.prisma.evaluation.update({
      where: { id: ev.id },
      data: { ...resetResult(), status: 'queued', lane: 'realtime' },
    });
    await this.enqueue([{ id: ev.id, lane: 'realtime', jobId: `eval-${ev.id}-${Date.now()}` }]);
    return toView(updated);
  }

  /** Records the teacher's decision. */
  async review(client: AuthenticatedClient, id: string, dto: ReviewDto) {
    const ev = await this.load(client, id);
    if (ev.status !== 'completed') {
      throw new AppError('conflict', 'Only completed evaluations can be reviewed', HttpStatus.CONFLICT);
    }
    const question = await this.prisma.questionContext.findUniqueOrThrow({ where: { id: ev.questionId } });
    const rubric = rubricSchema.parse(question.rubric);
    const ids = new Set(rubric.criteria.map((c) => c.id));

    let finalCriteria: { id: string; awarded: number; max: number }[] | null = null;
    let finalScore: number | null = null;

    if (dto.decision === 'accepted') {
      const suggested = (ev.criteria as { id: string; awarded: number; max: number }[] | null) ?? [];
      finalCriteria = suggested.map((c) => ({ id: c.id, awarded: c.awarded, max: c.max }));
      finalScore = ev.suggestedScore;
    } else if (dto.decision === 'adjusted') {
      const unknown = (dto.finalCriteria ?? []).filter((c) => !ids.has(c.id)).map((c) => c.id);
      if (unknown.length > 0) {
        throw new AppError('validation_failed', `Unknown criterion ids: ${unknown.join(', ')}`, HttpStatus.BAD_REQUEST);
      }
      const applied = applyFinalCriteria(rubric, dto.finalCriteria ?? [], question.markStep);
      finalCriteria = applied.criteria;
      finalScore = applied.total;
    }

    const updated = await this.prisma.evaluation.update({
      where: { id: ev.id },
      data: {
        decision: dto.decision,
        finalScore,
        finalCriteria: finalCriteria ? json(finalCriteria) : Prisma.DbNull,
        reviewedAt: new Date(),
      },
    });
    return toView(updated);
  }
}
