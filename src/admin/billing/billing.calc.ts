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
