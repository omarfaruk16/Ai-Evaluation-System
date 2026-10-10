// Client-side copy of the server's billing maths (src/admin/billing/billing.calc.ts), for live
// previews. Invoices and statements always come from the server.

import type { Charges, InvoiceLine, Plan, Prices, UsageCounts } from './types';

export type PlanTerms = Pick<
  Plan,
  | 'currency'
  | 'billingModel'
  | 'monthlyFee'
  | 'includedAnswers'
  | 'pricePerAnswer'
  | 'pricePerRubricDraft'
  | 'markupPercent'
  | 'chargeBlank'
  | 'chargeReused'
  | 'taxPercent'
>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function billableAnswers(u: UsageCounts, p: Pick<PlanTerms, 'chargeBlank' | 'chargeReused'>) {
  return Math.max(0, u.completed - (p.chargeBlank ? 0 : u.blank) - (p.chargeReused ? 0 : u.reused));
}

export function computeCharges(u: UsageCounts, plan: PlanTerms, fx: number): Charges {
  const lines: InvoiceLine[] = [];
  const line = (description: string, quantity: number, unitPrice: number) =>
    lines.push({ description, quantity, unitPrice, amount: round2(quantity * unitPrice) });
  const billable = billableAnswers(u, plan);
  const cost = u.costUsd * fx;
  if (plan.monthlyFee > 0) line('Monthly subscription', 1, plan.monthlyFee);
  if (plan.billingModel === 'per_answer') {
    if (plan.includedAnswers > 0) {
      const included = Math.min(billable, plan.includedAnswers);
      line(`AI-marked answers (${plan.includedAnswers.toLocaleString('en-US')} included)`, included, 0);
      if (billable > included) line('Additional AI-marked answers', billable - included, plan.pricePerAnswer);
    } else if (billable > 0 || plan.monthlyFee === 0) {
      line('AI-marked answers', billable, plan.pricePerAnswer);
    }
  } else {
    line(`AI usage (${billable.toLocaleString('en-US')} answers marked)`, 1, cost * (1 + plan.markupPercent / 100));
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
    costUsd: u.costUsd,
    cost: round2(cost),
    margin,
    marginPercent: subtotal > 0 ? round2((margin / subtotal) * 100) : null,
  };
}

/** USD for one model call from token counts (cached input at the cache price when there is one). */
export function callCostUsd(t: { input: number; cached: number; output: number }, p: Prices) {
  const cachedPrice = p.cachedInput > 0 ? p.cachedInput : p.input;
  const cached = Math.min(t.cached, t.input);
  return ((t.input - cached) * p.input + cached * cachedPrice + t.output * p.output) / 1e6;
}

export interface AnswerCostInputs {
  /** Tokens of the fixed instructions (system prompt + tags). */
  promptBaseTokens: number;
  /** Question + model answer + rubric, in tokens. */
  questionTokens: number;
  answerWords: number;
  tokensPerWord: number;
  outputTokens: number;
  /** Share of input tokens served from the provider's prompt cache (0–1). */
  cacheShare: number;
  /** Share of answers whose marks the teacher changes, which triggers a feedback rewrite (0–1). */
  adjustRate: number;
  /** Extra for retries and failed calls (0–1). */
  overhead: number;
}

/** Estimated USD per model-marked answer, including the feedback rewrite when a teacher adjusts marks. */
export function estimateAnswerCostUsd(i: AnswerCostInputs, prices: Prices) {
  const input = i.promptBaseTokens + i.questionTokens + i.answerWords * i.tokensPerWord;
  const marking = callCostUsd({ input, cached: input * i.cacheShare, output: i.outputTokens }, prices);
  // A feedback rewrite sends about the same context and returns a short list.
  const feedback = callCostUsd({ input: input + 120, cached: 0, output: 260 }, prices);
  return { inputTokens: Math.round(input), perAnswer: (marking + feedback * i.adjustRate) * (1 + i.overhead), marking, feedback };
}

/** About 1,100 tokens in and 500 out per rubric draft, plus a retry one time in five. */
export const estimateRubricDraftUsd = (prices: Prices) => callCostUsd({ input: 1100, cached: 0, output: 500 }, prices) * 1.2;
