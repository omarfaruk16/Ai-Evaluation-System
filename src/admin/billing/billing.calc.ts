// Pure billing maths: what a client owes for one period, and what it cost you.

export interface PlanTerms {
  currency: string;
  billingModel: 'per_answer' | 'cost_plus';
  monthlyFee: number;
  /** per_answer: answers covered by the monthly fee. */
  includedAnswers: number;
  /** per_answer: price of each answer beyond the included ones. */
  pricePerAnswer: number;
  pricePerRubricDraft: number;
  /** cost_plus: added on top of the AI cost. */
  markupPercent: number;
  chargeBlank: boolean;
  chargeReused: boolean;
  taxPercent: number;
}

/** One client's activity in a period. `blank` and `reused` are subsets of `completed`. */
export interface UsageCounts {
  completed: number;
  blank: number;
  reused: number;
  failed: number;
  rubricDrafts: number;
  /** Everything the client's calls cost you, failed calls and feedback rewrites included. */
  costUsd: number;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Charges {
  billableAnswers: number;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  costUsd: number;
  /** Your AI cost converted to the plan currency. */
  cost: number;
  /** subtotal − cost (tax is passed on, so it isn't margin). */
  margin: number;
  marginPercent: number | null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;

export function billableAnswers(u: UsageCounts, plan: Pick<PlanTerms, 'chargeBlank' | 'chargeReused'>): number {
  return Math.max(0, u.completed - (plan.chargeBlank ? 0 : u.blank) - (plan.chargeReused ? 0 : u.reused));
}

/**
 * @param fx plan-currency units per 1 USD (1 for USD plans)
 */
export function computeCharges(u: UsageCounts, plan: PlanTerms, fx: number): Charges {
  const lines: InvoiceLine[] = [];
  const line = (description: string, quantity: number, unitPrice: number) =>
    lines.push({ description, quantity, unitPrice: round4(unitPrice), amount: round2(quantity * unitPrice) });

  const billable = billableAnswers(u, plan);
  const cost = u.costUsd * fx;

  if (plan.monthlyFee > 0) line('Monthly subscription', 1, plan.monthlyFee);

  if (plan.billingModel === 'per_answer') {
    if (plan.includedAnswers > 0) {
      const included = Math.min(billable, plan.includedAnswers);
      line(`AI-marked answers (${plan.includedAnswers.toLocaleString('en-US')} included in the subscription)`, included, 0);
      const extra = billable - included;
      if (extra > 0) line('Additional AI-marked answers', extra, plan.pricePerAnswer);
    } else if (billable > 0 || plan.monthlyFee === 0) {
      line('AI-marked answers', billable, plan.pricePerAnswer);
    }
  } else {
    const usage = cost * (1 + plan.markupPercent / 100);
    line(`AI usage (${billable.toLocaleString('en-US')} answers marked)`, 1, usage);
  }

  if (u.rubricDrafts > 0 && plan.pricePerRubricDraft > 0) line('AI rubric drafts', u.rubricDrafts, plan.pricePerRubricDraft);

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2((subtotal * plan.taxPercent) / 100);
  const margin = round2(subtotal - cost);
  return {
    billableAnswers: billable,
    lines,
    subtotal,
    tax,
    total: round2(subtotal + tax),
    costUsd: round4(u.costUsd),
    cost: round2(cost),
    margin,
    marginPercent: subtotal > 0 ? round2((margin / subtotal) * 100) : null,
  };
}

/** One group's activity in a period (a project's own grouping, e.g. an exam). */
export interface GroupUsage extends UsageCounts {
  groupId: string | null;
}

export interface GroupCharge {
  groupId: string | null;
  billableAnswers: number;
  failed: number;
  rubricDrafts: number;
  subtotal: number;
  total: number;
}

/**
 * Splits a period's charges across groups: rubric-draft charges by drafts, everything else
 * (subscription, answers or AI usage) by billable answers on per-answer plans and by AI cost on
 * cost-plus plans. Work with no group, or a charge nothing can carry, goes to the null group.
 * Rounded so the groups add up exactly to the period's subtotal and total.
 */
export function allocateCharges(charges: Charges, plan: PlanTerms, groups: GroupUsage[]): GroupCharge[] {
  const draftAmount = round2(
    charges.lines.filter((l) => l.description === 'AI rubric drafts').reduce((s, l) => s + l.amount, 0),
  );
  const rest = charges.subtotal - draftAmount;
  const rows = new Map<string | null, GroupCharge & { raw: number }>();
  const row = (g: string | null) => {
    let r = rows.get(g);
    if (!r) rows.set(g, (r = { groupId: g, billableAnswers: 0, failed: 0, rubricDrafts: 0, subtotal: 0, total: 0, raw: 0 }));
    return r;
  };
  for (const g of groups) {
    const r = row(g.groupId);
    r.billableAnswers += billableAnswers(g, plan);
    r.failed += g.failed;
    r.rubricDrafts += g.rubricDrafts;
  }
  const spread = (amount: number, weight: (g: GroupUsage) => number) => {
    if (amount === 0) return;
    const sum = groups.reduce((s, g) => s + weight(g), 0);
    if (sum <= 0) {
      row(null).raw += amount;
      return;
    }
    for (const g of groups) row(g.groupId).raw += (amount * weight(g)) / sum;
  };
  spread(draftAmount, (g) => g.rubricDrafts);
  spread(rest, plan.billingModel === 'per_answer' ? (g) => billableAnswers(g, plan) : (g) => g.costUsd);

  const list = [...rows.values()];
  const fit = (key: 'subtotal' | 'total', target: number, factor: number) => {
    for (const r of list) r[key] = round2(r.raw * factor);
    const diff = round2(target - list.reduce((s, r) => s + r[key], 0));
    if (diff !== 0 && list.length > 0) {
      const largest = list.reduce((a, b) => (Math.abs(b.raw) > Math.abs(a.raw) ? b : a));
      largest[key] = round2(largest[key] + diff);
    }
  };
  fit('subtotal', charges.subtotal, 1);
  fit('total', charges.total, charges.subtotal > 0 ? charges.total / charges.subtotal : 1);
  return list
    .filter((r) => r.total !== 0 || r.billableAnswers > 0 || r.failed > 0 || r.rubricDrafts > 0)
    .map(({ raw: _raw, ...r }) => r);
}
