import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePassword, hashPassword } from '../../src/admin/auth/password';
import { createApp } from '../../src/app.factory';
import { resetLeadLimits } from '../../src/leads/leads';

// The operator console API (/admin-api): sign-in and CSRF guard, model profiles, client keys,
// pricing plans, statements and invoices, the playground and queue controls.

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
const EMAIL = 'ops@console.test';
const PASSWORD = generatePassword();
const CSRF = { 'X-AMS-Console': '1' };

let agent: ReturnType<typeof request.agent>;

const rubric = {
  criteria: [
    { id: 'c1', criterion: 'Sequence numbers and ACKs', marks: 2, awardWhen: '' },
    { id: 'c2', criterion: 'Retransmission on timeout', marks: 2, awardWhen: '' },
  ],
};
const question = { text: 'How does TCP give reliable delivery?', modelAnswer: 'Sequence numbers and ACKs; retransmission on timeout.', maxMarks: 4, markStep: 0.5, rubric };

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > ms) throw new Error(`Timed out: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'ignore' });
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AdminSession", "AdminUser", "Invoice", "PricingPlan", "RubricDraft", "WebhookDelivery", "LlmCall", "Evaluation", "QuestionContext", "Client", "ModelProfile", "AppSetting", "Lead" CASCADE',
  );
  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
  await prisma.adminUser.create({ data: { email: EMAIL, name: 'Ops', passwordHash: await hashPassword(PASSWORD) } });

  app = await createApp({ embeddedWorkers: true, logger: false });
  await app.init();
  http = app.getHttpServer();
  agent = request.agent(http);
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('console sign-in', () => {
  it('requires the console header on changes (CSRF guard)', async () => {
    const res = await request(http).post('/admin-api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(http).post('/admin-api/auth/login').set(CSRF).send({ email: EMAIL, password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Wrong email or password');
  });

  it('locks an email after repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (await request(http).post('/admin-api/auth/login').set(CSRF).send({ email: 'nobody@console.test', password: 'nope-nope-1' })).status;
    }
    expect(last).toBe(429);
  });

  it('signs in with an httpOnly, SameSite=Strict cookie scoped to /admin-api', async () => {
    expect((await request(http).get('/admin-api/auth/me')).status).toBe(401);
    const res = await agent.post('/admin-api/auth/login').set(CSRF).send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ams_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/admin-api/);
    const me = await agent.get('/admin-api/auth/me');
    expect(me.body).toMatchObject({ email: EMAIL, name: 'Ops' });
  });

  it('refuses changes without the header even with a valid session', async () => {
    expect((await agent.post('/admin-api/plans').send({})).status).toBe(403);
  });
});

describe('model profiles', () => {
  let mockB = '';

  it('seeds the .env model as the first profile, used for every task', async () => {
    const res = await agent.get('/admin-api/models');
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(1);
    const id = res.body.profiles[0].id;
    expect(res.body.assignments).toEqual({ marking: id, rubric_draft: id });
  });

  it('only accepts *_API_KEY variables for keys', async () => {
    const res = await agent
      .post('/admin-api/models')
      .set(CSRF)
      .send({ name: 'Leaky', provider: 'openai_compatible', model: 'x', baseUrl: 'https://api.example.com/v1', apiKeyEnv: 'DATABASE_URL', prices: { input: 0, cachedInput: 0, output: 0 } });
    expect(res.status).toBe(400);
  });

  it('creates a profile, assigns it and refuses to archive it while in use', async () => {
    const created = await agent
      .post('/admin-api/models')
      .set(CSRF)
      .send({ name: 'Mock B', provider: 'mock', model: 'mock/keyword-overlap', prices: { input: 1, cachedInput: 0, output: 2 } });
    expect(created.status).toBe(201);
    mockB = created.body.id;
    const list = await agent.get('/admin-api/models');
    const first = list.body.profiles.find((p: { name: string }) => p.name !== 'Mock B').id;
    const assigned = await agent.put('/admin-api/models/assignments').set(CSRF).send({ marking: mockB, rubric_draft: first });
    expect(assigned.status).toBe(200);
    expect(assigned.body.marking).toBe(mockB);
    expect((await agent.post(`/admin-api/models/${mockB}/archive`).set(CSRF)).status).toBe(409);
  });

  it('test-marks the sample with a profile and prices the call from its prices', async () => {
    const res = await agent.post(`/admin-api/models/${mockB}/test`).set(CSRF);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.criteria.length).toBeGreaterThan(0);
    expect(res.body.costEstimated).toBe(true);
    expect(res.body.usage.costUsd).toBeGreaterThan(0);
    const call = await prisma.llmCall.findFirst({ where: { origin: 'console' }, orderBy: { id: 'desc' } });
    expect(call).toMatchObject({ clientId: null, profileId: mockB, costEstimated: true, ok: true });
  });
});

describe('clients, plans, statements and invoices', () => {
  let clientId = '';
  let apiKey = '';
  let planId = '';
  let invoiceId = '';

  it('creates a client and shows its key once', async () => {
    const res = await agent.post('/admin-api/clients').set(CSRF).send({ name: 'Uni', contactName: 'Exam office' });
    expect(res.status).toBe(201);
    clientId = res.body.client.id;
    apiKey = res.body.apiKey;
    expect(apiKey).toMatch(/^ams_/);
    expect(res.body.webhookSecret).toMatch(/^whsec_/);
    expect(JSON.stringify((await agent.get(`/admin-api/clients/${clientId}`)).body)).not.toContain(apiKey);
    expect((await request(http).get('/v1/usage').set('Authorization', `Bearer ${apiKey}`)).status).toBe(200);
  });

  it('rotating the key stops the old one straight away', async () => {
    const res = await agent.post(`/admin-api/clients/${clientId}/rotate-key`).set(CSRF);
    expect((await request(http).get('/v1/usage').set('Authorization', `Bearer ${apiKey}`)).status).toBe(401);
    apiKey = res.body.apiKey;
    expect((await request(http).get('/v1/usage').set('Authorization', `Bearer ${apiKey}`)).status).toBe(200);
  });

  it('bills a month under a per-answer plan', async () => {
    const plan = await agent
      .post('/admin-api/plans')
      .set(CSRF)
      .send({ name: 'Small', currency: 'BDT', billingModel: 'per_answer', monthlyFee: 1000, includedAnswers: 1, pricePerAnswer: 10, taxPercent: 0 });
    expect(plan.status).toBe(201);
    planId = plan.body.id;
    expect((await agent.patch(`/admin-api/clients/${clientId}`).set(CSRF).send({ planId })).status).toBe(200);

    const submit = await request(http)
      .post('/v1/evaluations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        question,
        answers: [
          { externalId: 'a1', text: 'Sequence numbers and ACKs, and retransmission after a timeout.' },
          { externalId: 'a2', text: 'It uses ACKs.' },
          { externalId: 'a3', text: '   ' },
        ],
      });
    expect(submit.status).toBe(202);
    for (const e of submit.body.evaluations as { id: string }[]) {
      await waitFor(
        () => request(http).get(`/v1/evaluations/${e.id}`).set('Authorization', `Bearer ${apiKey}`).then((r) => r.body.status as string),
        (s) => s === 'completed',
      );
    }

    const st = await agent.get('/admin-api/billing/statements');
    const row = st.body.rows.find((r: { client: { id: string } }) => r.client.id === clientId);
    expect(row.usage).toMatchObject({ completed: 3, blank: 1, failed: 0 });
    expect(row.usage.costUsd).toBeGreaterThan(0);
    expect(row.charges.billableAnswers).toBe(2);
    expect(row.charges.lines.map((l: { amount: number }) => l.amount)).toEqual([1000, 0, 10]);
    expect(row.charges.subtotal).toBe(1010);
  });

  it('freezes the statement into a numbered invoice and moves it through its states', async () => {
    const st = await agent.get('/admin-api/billing/statements');
    const created = await agent.post('/admin-api/billing/invoices').set(CSRF).send({ clientId, month: st.body.month });
    expect(created.status).toBe(201);
    invoiceId = created.body.id;
    expect(created.body.number).toBe(`AMS-${st.body.month.slice(0, 4)}-0001`);
    expect(created.body.total).toBe(1010);
    expect(created.body.month).toBe(st.body.month);
    expect(created.body.parties.to.organisation).toBe('Uni');

    // Later price changes don't touch the invoice.
    await agent.patch(`/admin-api/plans/${planId}`).set(CSRF).send({ monthlyFee: 9999 });
    expect((await agent.get(`/admin-api/billing/invoices/${invoiceId}`)).body.total).toBe(1010);

    expect((await agent.post('/admin-api/billing/invoices').set(CSRF).send({ clientId, month: st.body.month })).status).toBe(409);
    const issued = await agent.patch(`/admin-api/billing/invoices/${invoiceId}`).set(CSRF).send({ status: 'issued' });
    expect(issued.body.issuedAt).toBeTruthy();
    expect(issued.body.dueAt).toBeTruthy();
    expect((await agent.patch(`/admin-api/billing/invoices/${invoiceId}`).set(CSRF).send({ status: 'draft' })).status).toBe(409);
    expect((await agent.delete(`/admin-api/billing/invoices/${invoiceId}`).set(CSRF)).status).toBe(409);
    const paid = await agent.patch(`/admin-api/billing/invoices/${invoiceId}`).set(CSRF).send({ status: 'paid' });
    expect(paid.body.paidAt).toBeTruthy();
    const csv = await agent.get('/admin-api/billing/invoices.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(created.body.number);
  });

  it('refuses to delete a plan that clients use', async () => {
    expect((await agent.delete(`/admin-api/plans/${planId}`).set(CSRF)).status).toBe(409);
  });

  it('reports real unit costs for quotes', async () => {
    const res = await agent.get('/admin-api/billing/unit-costs?days=30');
    expect(res.body.sample).toMatchObject({ completed: 3, blank: 1 });
    expect(res.body.costPerAnswerUsd).toBeGreaterThan(0);
    expect(res.body.markingProfile.name).toBe('Mock B');
  });

  it('lists evaluations with their calls and cost', async () => {
    const list = await agent.get(`/admin-api/evaluations?clientId=${clientId}&status=completed`);
    expect(list.body.total).toBe(3);
    const marked = list.body.items.find((e: { flags: string[] }) => !e.flags.includes('blank'));
    const detail = await agent.get(`/admin-api/evaluations/${marked.id}`);
    expect(detail.body.calls.length).toBeGreaterThan(0);
    expect(detail.body.costUsd).toBeGreaterThan(0);
    expect(detail.body.question.rubric.criteria).toHaveLength(2);
  });
});

describe('operations', () => {
  it('pauses and resumes a queue', async () => {
    expect((await agent.post('/admin-api/system/queues/realtime/pause').set(CSRF)).status).toBe(204);
    let sys = await agent.get('/admin-api/system');
    expect(sys.body.queues.find((q: { key: string }) => q.key === 'realtime').paused).toBe(true);
    await agent.post('/admin-api/system/queues/realtime/resume').set(CSRF);
    sys = await agent.get('/admin-api/system');
    expect(sys.body.queues.find((q: { key: string }) => q.key === 'realtime').paused).toBe(false);
  });

  it('shows the overview', async () => {
    const res = await agent.get('/admin-api/overview?days=7');
    expect(res.status).toBe(200);
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.totals.completed).toBe(3);
    expect(res.body.models.marking.name).toBe('Mock B');
  });

  it('signs out', async () => {
    expect((await agent.post('/admin-api/auth/logout').set(CSRF)).status).toBe(204);
    expect((await agent.get('/admin-api/auth/me')).status).toBe(401);
  });
});

describe('website leads', () => {
  const pilot = {
    kind: 'pilot',
    name: 'Ayesha Rahman',
    email: 'Ayesha@Example.edu',
    phone: '+880 1711 000000',
    institution: 'Example University',
    website: 'example.edu',
    message: 'We would like to pilot AI marking for one course this term.',
    sourcePage: '/pilot',
  };

  it('accepts a pilot request from the website without an API key', async () => {
    resetLeadLimits();
    const res = await request(http).post('/v1/leads').set('Origin', 'https://scholametrix.tech').send(pilot);
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe('https://scholametrix.tech');
  });

  it('answers the CORS preflight only for allowed origins', async () => {
    const ok = await request(http).options('/v1/leads').set('Origin', 'https://scholametrix.tech');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-methods']).toContain('POST');
    const other = await request(http).options('/v1/leads').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requires a phone and institution for pilots and explains each problem', async () => {
    resetLeadLimits();
    const res = await request(http).post('/v1/leads').send({ kind: 'pilot', name: 'A B', email: 'not-an-email', message: 'short' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'message', 'institution', 'phone']));
  });

  it('silently drops bots that fill the hidden field', async () => {
    resetLeadLimits();
    const before = await prisma.lead.count();
    const res = await request(http).post('/v1/leads').send({ ...pilot, company: 'spam inc' });
    expect(res.status).toBe(201);
    expect(await prisma.lead.count()).toBe(before);
  });

  it('rate-limits one address', async () => {
    resetLeadLimits();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(http).post('/v1/leads').send({ ...pilot, kind: 'contact', email: `x${i}@example.edu` })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('lists leads in the console, updates status and notes, exports CSV', async () => {
    expect((await request(http).get('/admin-api/leads')).status).toBe(401);
    agent = request.agent(http);
    expect((await agent.post('/admin-api/auth/login').set(CSRF).send({ email: EMAIL, password: PASSWORD })).status).toBe(200);
    const list = await agent.get('/admin-api/leads?kind=pilot');
    expect(list.status).toBe(200);
    const lead = list.body.items[0];
    expect(lead).toMatchObject({ name: 'Ayesha Rahman', email: 'ayesha@example.edu', website: 'https://example.edu', status: 'new' });
    expect(list.body.counts.new).toBeGreaterThan(0);

    expect((await agent.patch(`/admin-api/leads/${lead.id}`).send({ status: 'contacted' })).status).toBe(403);
    const upd = await agent.patch(`/admin-api/leads/${lead.id}`).set(CSRF).send({ status: 'contacted', note: '=called, demo Monday' });
    expect(upd.body).toMatchObject({ status: 'contacted', note: '=called, demo Monday' });
    expect(upd.body.contactedAt).not.toBeNull();

    const csv = await agent.get('/admin-api/leads/export.csv');
    expect(csv.text).toContain('Ayesha Rahman');
    expect(csv.text).toContain("\"'=called, demo Monday\"");

    expect((await agent.delete(`/admin-api/leads/${lead.id}`).set(CSRF)).status).toBe(204);
  });
});
