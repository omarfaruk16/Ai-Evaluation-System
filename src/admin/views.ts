import type { Client, Invoice, LlmCall, ModelProfile, PricingPlan, WebhookDelivery } from '@prisma/client';
import type { PlanTerms } from './billing/billing.calc';
import { fromRow } from '../llm/profile';
import { currentMonth } from './time';
import { maskSecret } from '../common/mask';

const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function planTerms(p: PricingPlan): PlanTerms {
  return {
    currency: p.currency,
    billingModel: p.billingModel,
    monthlyFee: Number(p.monthlyFee),
    includedAnswers: p.includedAnswers,
    pricePerAnswer: Number(p.pricePerAnswer),
    pricePerRubricDraft: Number(p.pricePerRubricDraft),
    markupPercent: Number(p.markupPercent),
    chargeBlank: p.chargeBlank,
    chargeReused: p.chargeReused,
    taxPercent: Number(p.taxPercent),
  };
}

export const planView = (p: PricingPlan) => ({
  id: p.id,
  name: p.name,
  ...planTerms(p),
  notes: p.notes,
  archived: p.archived,
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
});

export const clientView = (c: Client & { plan?: PricingPlan | null }) => ({
  id: c.id,
  name: c.name,
  // Never the real prefix: the console shows the first 4 characters only.
  apiKeyHint: maskSecret(c.apiKeyPrefix),
  // Whether the console can show the key again (it is stored encrypted).
  apiKeyStored: c.apiKeyEncrypted !== null,
  webhookUrl: c.webhookUrl,
  lastSeenAt: iso(c.lastSeenAt),
  monthlyBudgetUsd: num(c.monthlyBudgetUsd),
  active: c.active,
  planId: c.planId,
  plan: c.plan ? { id: c.plan.id, name: c.plan.name, currency: c.plan.currency } : null,
  contactName: c.contactName,
  contactEmail: c.contactEmail,
  billingAddress: c.billingAddress,
  notes: c.notes,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

export const profileView = (p: ModelProfile) => {
  const r = fromRow(p);
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    model: p.model,
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    routing: r.routing,
    reasoning: r.reasoning,
    temperature: p.temperature,
    seed: p.seed,
    maxOutputTokens: p.maxOutputTokens,
    timeoutMs: p.timeoutMs,
    jsonMode: r.jsonMode,
    prices: r.prices,
    notes: p.notes,
    archived: p.archived,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
};

/** The billing month (YYYY-MM) an invoice covers, in the time zone it was made in. */
export function invoiceMonth(i: Pick<Invoice, 'periodStart' | 'parties'>): string {
  const tz = (i.parties as { timeZone?: unknown } | null)?.timeZone;
  try {
    return currentMonth(typeof tz === 'string' ? tz : 'UTC', i.periodStart);
  } catch {
    return currentMonth('UTC', i.periodStart);
  }
}

export const invoiceView = (i: Invoice & { client?: Pick<Client, 'id' | 'name'> }) => ({
  id: i.id,
  number: i.number,
  month: invoiceMonth(i),
  clientId: i.clientId,
  clientName: i.client?.name ?? null,
  periodStart: iso(i.periodStart),
  periodEnd: iso(i.periodEnd),
  currency: i.currency,
  parties: i.parties,
  lines: i.lines,
  subtotal: Number(i.subtotal),
  taxPercent: Number(i.taxPercent),
  tax: Number(i.tax),
  total: Number(i.total),
  costUsd: Number(i.costUsd),
  fxUsdRate: num(i.fxUsdRate),
  status: i.status,
  issuedAt: iso(i.issuedAt),
  dueAt: iso(i.dueAt),
  paidAt: iso(i.paidAt),
  notes: i.notes,
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
});

export const llmCallView = (c: LlmCall) => ({
  id: c.id.toString(),
  clientId: c.clientId,
  origin: c.origin,
  evaluationId: c.evaluationId,
  kind: c.kind,
  profileId: c.profileId,
  model: c.model,
  host: c.host,
  promptVersion: c.promptVersion,
  inputTokens: c.inputTokens,
  outputTokens: c.outputTokens,
  cachedTokens: c.cachedTokens,
  reasoningTokens: c.reasoningTokens,
  costUsd: Number(c.costUsd),
  costEstimated: c.costEstimated,
  latencyMs: c.latencyMs,
  ok: c.ok,
  error: c.error,
  createdAt: iso(c.createdAt),
});

export const webhookView = (w: WebhookDelivery & { client?: Pick<Client, 'name'> }) => ({
  id: w.id,
  clientId: w.clientId,
  clientName: w.client?.name ?? null,
  evaluationId: w.evaluationId,
  event: w.event,
  url: w.url,
  status: w.status,
  attempts: w.attempts,
  lastStatusCode: w.lastStatusCode,
  lastError: w.lastError,
  createdAt: iso(w.createdAt),
  deliveredAt: iso(w.deliveredAt),
});
