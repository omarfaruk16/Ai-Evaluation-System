import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { generateApiKey, generateWebhookSecret } from '../../src/auth/api-key';
import { verifySignature } from '../../src/webhooks/signature';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let receiver: Server;
const hooks: { event: string; signatureOk: boolean; body: { type: string; data: { evaluation: { id: string; status: string } } } }[] = [];

let key = '';
let brokeKey = '';
let webhookSecret = '';

const auth = () => ({ Authorization: `Bearer ${key}` });

const rubric = {
  criteria: [
    { id: 'c1', criterion: 'Sequence numbers + ACKs', marks: 2, awardWhen: 'Both sequence numbers and ACKs' },
    { id: 'c2', criterion: 'Retransmission', marks: 2, awardWhen: 'Timeout resend (1); duplicate ACKs (1)' },
    { id: 'c3', criterion: 'Checksum', marks: 1, awardWhen: 'Error detection' },
    { id: 'c4', criterion: 'Flow control', marks: 1, awardWhen: 'Receive window' },
  ],
};
const question = {
  externalId: 'q-tcp',
  text: 'Explain how TCP gives reliable delivery over an unreliable network.',
  modelAnswer: 'Sequence numbers and ACKs; retransmission on timeout or duplicate ACKs; checksum; receive window for flow control.',
  maxMarks: 6,
  markStep: 0.5,
  rubric,
};
const GOOD =
  'TCP numbers every byte with sequence numbers and the receiver sends ACKs back. On timeout the sender retransmits. A checksum detects errors.';

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > ms) throw new Error(`Timed out after ${ms} ms: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const getEval = async (id: string) => (await request(http).get(`/v1/evaluations/${id}`).set(auth())).body;
const settled = (s: string) => s === 'completed' || s === 'failed';

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'ignore',
  });
  await prisma.$executeRawUnsafe(
    'TRUNCATE "WebhookDelivery", "LlmCall", "Evaluation", "QuestionContext", "Client" CASCADE',
  );
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();

  webhookSecret = generateWebhookSecret();
  receiver = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      hooks.push({
        event: String(req.headers['x-ams-event']),
        signatureOk: verifySignature(webhookSecret, raw, req.headers['x-ams-signature'] as string),
        body: JSON.parse(raw),
      });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const main = generateApiKey();
  key = main.key;
  await prisma.client.create({
    data: { name: 'e2e', apiKeyHash: main.hash, apiKeyPrefix: main.prefix, webhookUrl: hookUrl, webhookSecret },
  });
  const broke = generateApiKey();
  brokeKey = broke.key;
  await prisma.client.create({
    data: {
      name: 'e2e-broke',
      apiKeyHash: broke.hash,
      apiKeyPrefix: broke.prefix,
      webhookSecret: generateWebhookSecret(),
      monthlyBudgetUsd: 0,
    },
  });

  app = await createApp({ embeddedWorkers: true, logger: false });
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => receiver?.close(r));
  await prisma.$disconnect();
});

describe('auth and validation', () => {
  it('rejects requests without a valid key', async () => {
    expect((await request(http).get('/v1/usage')).status).toBe(401);
    const bad = await request(http).get('/v1/usage').set({ Authorization: 'Bearer ams_nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('unauthorized');
  });

  it('reports every invalid field', async () => {
    const res = await request(http).post('/v1/evaluations').set(auth()).send({ question });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.some((d: { path: string }) => d.path === 'answers')).toBe(true);
  });

  it('rejects a rubric that does not add up to maxMarks', async () => {
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({ question: { ...question, maxMarks: 5 }, answers: [{ externalId: 'x', text: 'y' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_rubric');
  });

  it('answers the health check', async () => {
    const res = await request(http).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok', llm: { provider: 'mock' } });
  });
});

describe('rubric drafts', () => {
  it('drafts a rubric that adds up and traces to the model answer', async () => {
    const res = await request(http).post('/v1/rubrics/draft').set(auth()).send({
      question: question.text,
      modelAnswer: question.modelAnswer,
      maxMarks: 6,
    });
    expect(res.status).toBe(200);
    const criteria = res.body.rubric.criteria as { id: string; marks: number }[];
    expect(criteria.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(criteria.reduce((s, c) => s + c.marks, 0)).toBe(6);
    for (const s of res.body.sources) expect(question.modelAnswer).toContain(s.fromModelAnswer);
    expect(res.body.usage.costUsd).toBeGreaterThan(0);
  });
});

describe('trying a rubric', () => {
  const body = {
    question: question.text,
    modelAnswer: question.modelAnswer,
    maxMarks: 6,
    markStep: 0.5,
    rubric,
  };

  it('marks one answer straight away without storing it or revealing the model', async () => {
    const before = await prisma.evaluation.count();
    const res = await request(http).post('/v1/evaluations/try').set(auth()).send({ ...body, answer: GOOD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.criteria).toHaveLength(4);
    expect(res.body.result.suggestedScore).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('model');
    expect(res.body).not.toHaveProperty('usage');
    expect(await prisma.evaluation.count()).toBe(before);
  });

  it('scores a blank answer 0 without calling the model', async () => {
    const res = await request(http).post('/v1/evaluations/try').set(auth()).send({ ...body, answer: '  ' });
    expect(res.status).toBe(200);
    expect(res.body.result.suggestedScore).toBe(0);
    expect(res.body.note).toMatch(/blank/i);
  });

  it('rejects a rubric that does not add up', async () => {
    const res = await request(http)
      .post('/v1/evaluations/try')
      .set(auth())
      .send({ ...body, maxMarks: 7, answer: GOOD });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_rubric');
  });
});

describe('marking pipeline', () => {
  const ids: Record<string, string> = {};

  it('accepts answers, marks them and sends signed webhooks', async () => {
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({
        groupId: 'exam-1',
        question,
        answers: [
          { externalId: 'a1', text: GOOD },
          { externalId: 'a2', text: '   ' },
          { externalId: 'a3', text: 'Something about sequence numbers only.' },
          { externalId: 'a4', text: 'x'.repeat(600) },
        ],
      });
    expect(res.status).toBe(202);
    for (const e of res.body.evaluations) ids[e.externalId] = e.id;

    const byExt = Object.fromEntries(res.body.evaluations.map((e: { externalId: string }) => [e.externalId, e]));
    expect(byExt.a2.status).toBe('completed');
    expect(byExt.a4.status).toBe('failed');
    // Group of 4 is above ROUTER_SMALL_GROUP_MAX=3: first answer realtime, the rest deferred.
    expect(byExt.a1.lane).toBe('realtime');
    expect(byExt.a3.lane).toBe('deferred');

    const progress = await waitFor(
      async () => (await request(http).get('/v1/groups/exam-1/progress').set(auth())).body,
      (p) => p.done === true,
    );
    expect(progress.status).toMatchObject({ completed: 3, failed: 1 });

    const good = await getEval(ids.a1!);
    expect(good.status).toBe('completed');
    // Mock marks by keyword overlap: "detects errors" only half-matches "Error detection".
    expect(good.suggestedScore).toBe(3.5);
    expect(good.criteria.map((c: { awarded: number }) => c.awarded)).toEqual([2, 1, 0.5, 0]);
    expect(good.highlights.length).toBeGreaterThan(0);
    for (const h of good.highlights) expect(good.answerText.slice(h.start, h.end)).toBe(h.quote);
    expect(good).not.toHaveProperty('studentFeedback');
    expect(good.model).toBe('mock/keyword-overlap');
    expect(good.promptVersion).toBe('mark-v2');

    const blank = await getEval(ids.a2!);
    expect(blank).toMatchObject({ suggestedScore: 0, flags: ['blank'] });

    const tooLong = await getEval(ids.a4!);
    expect(tooLong.flags).toEqual(['too_long']);
    expect(tooLong.error).toContain('limit');

    await waitFor(async () => hooks.length, (n) => n >= 4);
    expect(hooks.every((h) => h.signatureOk)).toBe(true);
    const events = hooks.map((h) => `${h.body.data.evaluation.id}:${h.event}`);
    expect(events).toContain(`${ids.a1}:evaluation.completed`);
    expect(events).toContain(`${ids.a4}:evaluation.failed`);
  });

  it('is idempotent: resubmitting the same answers changes nothing and calls no model', async () => {
    const callsBefore = await prisma.llmCall.count();
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({ groupId: 'exam-1', question, answers: [{ externalId: 'a1', text: `  ${GOOD}\r\n` }] });
    expect(res.status).toBe(202);
    expect(res.body.evaluations[0]).toMatchObject({ id: ids.a1, status: 'completed' });
    expect(await prisma.llmCall.count()).toBe(callsBefore);
  });

  it('reuses the result for an identical answer from another student', async () => {
    const callsBefore = await prisma.llmCall.count();
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({ groupId: 'exam-1', question, answers: [{ externalId: 'a5', text: GOOD }] });
    expect(res.body.evaluations[0]).toMatchObject({ status: 'completed', reused: true });
    ids.a5 = res.body.evaluations[0].id;
    const ev = await getEval(ids.a5!);
    expect(ev.reusedFromId).toBe(ids.a1);
    expect(ev.suggestedScore).toBe(3.5);
    expect(await prisma.llmCall.count()).toBe(callsBefore);
  });

  it('re-marks an answer whose text changed', async () => {
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({
        groupId: 'exam-1',
        question,
        answers: [{ externalId: 'a3', text: 'The receive window gives flow control. Checksum detects errors.' }],
      });
    expect(res.body.evaluations[0].id).toBe(ids.a3);
    const ev = await waitFor(() => getEval(ids.a3!), (e) => e.status === 'completed' && e.answerText.includes('window'));
    expect(ev.criteria.find((c: { id: string }) => c.id === 'c4').awarded).toBe(1);
  });

  it('retries a flaky model call and fails cleanly on a fatal one', async () => {
    const res = await request(http)
      .post('/v1/evaluations')
      .set(auth())
      .send({
        groupId: 'exam-2',
        question,
        answers: [
          { externalId: 'f1', text: '__MOCK_FLAKY__ sequence numbers and acks are used.' },
          { externalId: 'f2', text: '__MOCK_FATAL__ anything' },
          { externalId: 'f3', text: '__MOCK_RETRYABLE__ anything' },
        ],
      });
    const [f1, f2, f3] = res.body.evaluations.map((e: { id: string }) => e.id);
    const flaky = await waitFor(() => getEval(f1), (e) => settled(e.status));
    expect(flaky.status).toBe('completed');
    const fatal = await waitFor(() => getEval(f2), (e) => settled(e.status));
    expect(fatal.status).toBe('failed');
    expect(fatal.error).toContain('Mock fatal');
    const exhausted = await waitFor(() => getEval(f3), (e) => settled(e.status));
    expect(exhausted.status).toBe('failed');
    const failedCalls = await prisma.llmCall.count({ where: { evaluationId: f3, ok: false } });
    expect(failedCalls).toBe(4);
  });

  it('records an accepted review as-is', async () => {
    const res = await request(http).post(`/v1/evaluations/${ids.a1}/review`).set(auth()).send({ decision: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({ decision: 'accepted', finalScore: 3.5 });
    expect(res.body.review).not.toHaveProperty('finalFeedback');
  });

  it('records adjusted marks without another AI call', async () => {
    const res = await request(http)
      .post(`/v1/evaluations/${ids.a5}/review`)
      .set(auth())
      .send({
        decision: 'adjusted',
        finalCriteria: [
          { id: 'c1', awarded: 2 },
          { id: 'c2', awarded: 2 },
          { id: 'c3', awarded: 1 },
          { id: 'c4', awarded: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.review.finalScore).toBe(5);
    expect(res.body.review.finalCriteria.map((c: { awarded: number }) => c.awarded)).toEqual([2, 2, 1, 0]);
    expect(await prisma.llmCall.count({ where: { evaluationId: ids.a5!, kind: 'feedback_rewrite' } })).toBe(0);
    const bad = await request(http)
      .post(`/v1/evaluations/${ids.a5}/review`)
      .set(auth())
      .send({ decision: 'adjusted', finalCriteria: [{ id: 'nope', awarded: 1 }] });
    expect(bad.status).toBe(400);
  });

  it('re-runs an evaluation on request', async () => {
    const res = await request(http).post(`/v1/evaluations/${ids.a1}/rerun`).set(auth());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    const ev = await waitFor(() => getEval(ids.a1!), (e) => e.status === 'completed');
    expect(ev.review).toBeNull();
  });

  it('lists with keyset paging and updatedSince for syncing', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: request.Response = await request(http)
        .get('/v1/evaluations')
        .query({ groupId: 'exam-1', limit: 2, ...(cursor ? { cursor } : {}) })
        .set(auth());
      expect(page.status).toBe(200);
      seen.push(...page.body.data.map((e: { id: string }) => e.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(5);

    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await request(http).get('/v1/evaluations').query({ updatedSince: future }).set(auth());
    expect(none.body.data).toEqual([]);
  });

  it('reports usage to the project without costs or tokens', async () => {
    const res = await request(http).get('/v1/usage').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.answers.completed).toBeGreaterThan(0);
    expect(res.body.rubricDrafts).toBeGreaterThan(0);
    expect(res.body.usageLimit).toEqual({ set: false, reached: false });
    expect(JSON.stringify(res.body)).not.toMatch(/cost|token|usd/i);
  });

  it('refuses work when the monthly budget is used up', async () => {
    const res = await request(http)
      .post('/v1/evaluations')
      .set({ Authorization: `Bearer ${brokeKey}` })
      .send({ question, answers: [{ externalId: 'b1', text: GOOD }] });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('budget_exceeded');
    expect(res.body.error.message).not.toMatch(/\$/);
  });

  it('keeps one client from reading another client’s evaluations', async () => {
    const res = await request(http).get(`/v1/evaluations/${ids.a1}`).set({ Authorization: `Bearer ${brokeKey}` });
    expect(res.status).toBe(404);
  });
});

describe('project setup (how a client connects itself)', () => {
  it('tells a key who it belongs to', async () => {
    const res = await request(http).get('/v1/me').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('e2e');
    expect(res.body.service.api).toBe('v1');
    expect(res.body.usageThisMonth.answersMarked).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/cost|usd|apiKey|secret/i);
    expect((await request(http).get('/v1/me')).status).toBe(401);
  });

  it('registers a webhook, issues a new signing secret and pings with it', async () => {
    const url = (await request(http).get('/v1/me').set(auth())).body.webhook.url as string;
    const res = await request(http).put('/v1/webhook').set(auth()).send({ url });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(url);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.secret).not.toBe(webhookSecret);
    webhookSecret = res.body.secret;

    hooks.length = 0;
    const ping = await request(http).post('/v1/webhook/test').set(auth());
    expect(ping.body).toMatchObject({ ok: true, status: 204, url });
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject({ event: 'ping', signatureOk: true });
  });

  it('rejects a bad webhook URL and can remove the webhook', async () => {
    expect((await request(http).put('/v1/webhook').set(auth()).send({ url: 'ftp://x' })).status).toBe(400);
    expect((await request(http).delete('/v1/webhook').set(auth())).status).toBe(204);
    expect((await request(http).get('/v1/me').set(auth())).body.webhook.url).toBeNull();
    expect((await request(http).post('/v1/webhook/test').set(auth())).status).toBe(400);
  });

  it('records when the key was last used', async () => {
    const row = await prisma.client.findFirstOrThrow({ where: { name: 'e2e' } });
    expect(row.lastSeenAt).not.toBeNull();
  });
});
