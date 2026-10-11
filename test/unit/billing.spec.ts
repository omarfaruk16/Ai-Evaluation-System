import { describe, expect, it } from 'vitest';
import { passwordProblem, hashPassword, verifyPassword } from '../../src/admin/auth/password';
import {
  allocateCharges,
  billableAnswers,
  computeCharges,
  type GroupUsage,
  type PlanTerms,
  type UsageCounts,
} from '../../src/admin/billing/billing.calc';
import { currentMonth, monthPeriod, shiftMonth, zonedMidnight } from '../../src/admin/time';

const usage = (u: Partial<UsageCounts> = {}): UsageCounts => ({
  completed: 0,
  blank: 0,
  reused: 0,
  failed: 0,
  rubricDrafts: 0,
  costUsd: 0,
  ...u,
});

const perAnswer: PlanTerms = {
  currency: 'BDT',
  billingModel: 'per_answer',
  monthlyFee: 5000,
  includedAnswers: 2000,
  pricePerAnswer: 2,
  pricePerRubricDraft: 5,
  markupPercent: 0,
  chargeBlank: false,
  chargeReused: true,
  taxPercent: 15,
};

describe('billable answers', () => {
  it('drops blank answers and, when the plan says so, reused ones', () => {
    const u = usage({ completed: 100, blank: 10, reused: 5 });
    expect(billableAnswers(u, { chargeBlank: false, chargeReused: true })).toBe(90);
    expect(billableAnswers(u, { chargeBlank: false, chargeReused: false })).toBe(85);
    expect(billableAnswers(u, { chargeBlank: true, chargeReused: true })).toBe(100);
  });
});

describe('per-answer plans', () => {
  it('covers included answers with the fee and prices the rest', () => {
    const c = computeCharges(usage({ completed: 2600, blank: 100, rubricDrafts: 4, costUsd: 1.5 }), perAnswer, 122);
    expect(c.billableAnswers).toBe(2500);
    expect(c.lines).toEqual([
      { description: 'Monthly subscription', quantity: 1, unitPrice: 5000, amount: 5000 },
      { description: 'AI-marked answers (2,000 included in the subscription)', quantity: 2000, unitPrice: 0, amount: 0 },
      { description: 'Additional AI-marked answers', quantity: 500, unitPrice: 2, amount: 1000 },
      { description: 'AI rubric drafts', quantity: 4, unitPrice: 5, amount: 20 },
    ]);
    expect(c.subtotal).toBe(6020);
    expect(c.tax).toBe(903);
    expect(c.total).toBe(6923);
    expect(c.cost).toBe(183);
    // Tax is passed on to the government, so it isn't margin.
    expect(c.margin).toBe(5837);
    expect(c.marginPercent).toBeCloseTo(96.96, 2);
  });

  it('charges the fee alone in a quiet month', () => {
    const c = computeCharges(usage(), perAnswer, 122);
    expect(c.lines.map((l) => l.description)).toEqual([
      'Monthly subscription',
      'AI-marked answers (2,000 included in the subscription)',
    ]);
    expect(c.subtotal).toBe(5000);
  });

  it('pay-as-you-go: no fee, every answer priced, empty month costs nothing', () => {
    const payg = { ...perAnswer, monthlyFee: 0, includedAnswers: 0, taxPercent: 0 };
    expect(computeCharges(usage({ completed: 300 }), payg, 122).subtotal).toBe(600);
    expect(computeCharges(usage(), payg, 122).subtotal).toBe(0);
    expect(computeCharges(usage(), payg, 122).marginPercent).toBeNull();
  });
});

describe('cost-plus plans', () => {
  it('bills the AI cost converted to the plan currency, plus the markup', () => {
    const plan: PlanTerms = { ...perAnswer, billingModel: 'cost_plus', monthlyFee: 1000, markupPercent: 200, taxPercent: 0, pricePerRubricDraft: 0 };
    const c = computeCharges(usage({ completed: 5000, costUsd: 2 }), plan, 120);
    expect(c.lines).toEqual([
      { description: 'Monthly subscription', quantity: 1, unitPrice: 1000, amount: 1000 },
      { description: 'AI usage (5,000 answers marked)', quantity: 1, unitPrice: 720, amount: 720 },
    ]);
    expect(c.cost).toBe(240);
    expect(c.margin).toBe(1480);
  });

  it('shows a loss when the price is below cost', () => {
    const plan = { ...perAnswer, monthlyFee: 0, includedAnswers: 0, pricePerAnswer: 0.01, taxPercent: 0 };
    const c = computeCharges(usage({ completed: 1000, costUsd: 1 }), plan, 122);
    expect(c.margin).toBeLessThan(0);
  });
});

describe('billing months in the business time zone', () => {
  it('starts Dhaka months at local midnight (UTC+6)', () => {
    const p = monthPeriod('2026-10', 'Asia/Dhaka');
    expect(p.start.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(monthPeriod('2026-12', 'Asia/Dhaka').end.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });

  it('handles daylight-saving zones', () => {
    // London is on BST (UTC+1) on 1 October and GMT on 1 November.
    const p = monthPeriod('2026-10', 'Europe/London');
    expect(p.start.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(zonedMidnight(2026, 0, 1, 'UTC').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('knows which month it is locally', () => {
    // 20:00 UTC on 31 October is already 1 November in Dhaka.
    expect(currentMonth('Asia/Dhaka', new Date('2026-10-31T20:00:00Z'))).toBe('2026-11');
    expect(currentMonth('UTC', new Date('2026-10-31T20:00:00Z'))).toBe('2026-10');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('rejects malformed months', () => {
    expect(() => monthPeriod('2026-13', 'UTC')).toThrow();
    expect(() => monthPeriod('Oct 2026', 'UTC')).toThrow();
  });
});

describe('console passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword('correct horse 12');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse 12', hash)).toBe(true);
    expect(await verifyPassword('wrong horse 12', hash)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('asks for a reasonable password', () => {
    expect(passwordProblem('short1')).toMatch(/10 characters/);
    expect(passwordProblem('onlyletters')).toMatch(/letters and digits/);
    expect(passwordProblem('letters4and5digits')).toBeNull();
    expect(passwordProblem('a long passphrase without digits')).toBeNull();
  });
});

describe('splitting a month between groups', () => {
  const g = (groupId: string | null, u: Partial<UsageCounts>): GroupUsage => ({ groupId, ...usage(u) });
  const sum = (rows: { subtotal: number; total: number }[], k: 'subtotal' | 'total') =>
    Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;

  it('splits answers and the fee by billable answers, drafts by drafts, and adds up exactly', () => {
    const groups = [
      g('exam-a', { completed: 1500, blank: 100 }),
      g('exam-b', { completed: 1200 }),
      g('part-x', { rubricDrafts: 3 }),
      g(null, { rubricDrafts: 1 }),
    ];
    const total = groups.reduce((u, x) => {
      u.completed += x.completed;
      u.blank += x.blank;
      u.rubricDrafts += x.rubricDrafts;
      return u;
    }, usage());
    const c = computeCharges(total, perAnswer, 122);
    const rows = allocateCharges(c, perAnswer, groups);
    expect(sum(rows, 'subtotal')).toBe(c.subtotal);
    expect(sum(rows, 'total')).toBe(c.total);
    const a = rows.find((r) => r.groupId === 'exam-a')!;
    const b = rows.find((r) => r.groupId === 'exam-b')!;
    expect(a.billableAnswers).toBe(1400);
    expect(a.subtotal / b.subtotal).toBeCloseTo(1400 / 1200, 2);
    expect(rows.find((r) => r.groupId === 'part-x')!.subtotal).toBe(15);
    expect(rows.find((r) => r.groupId === null)!.subtotal).toBe(5);
  });

  it('puts a fee nothing can carry on the null group', () => {
    const c = computeCharges(usage(), perAnswer, 122);
    const rows = allocateCharges(c, perAnswer, []);
    expect(rows).toEqual([{ groupId: null, billableAnswers: 0, failed: 0, rubricDrafts: 0, subtotal: 5000, total: 5750 }]);
  });

  it('splits a cost-plus charge by AI cost', () => {
    const plan: PlanTerms = { ...perAnswer, billingModel: 'cost_plus', monthlyFee: 0, markupPercent: 50, taxPercent: 0 };
    const groups = [g('a', { completed: 10, costUsd: 0.3 }), g('b', { completed: 10, costUsd: 0.1 })];
    const c = computeCharges(usage({ completed: 20, costUsd: 0.4 }), plan, 100);
    const rows = allocateCharges(c, plan, groups);
    expect(rows.find((r) => r.groupId === 'a')!.subtotal).toBe(45);
    expect(rows.find((r) => r.groupId === 'b')!.subtotal).toBe(15);
  });
});
