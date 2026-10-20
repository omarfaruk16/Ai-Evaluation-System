// Response shapes of /admin-api. Kept by hand next to the server's view functions (src/admin/views.ts).

export type Task = 'marking' | 'rubric_draft';
/** Kinds on recorded AI calls; 'feedback_rewrite' only appears on old rows. */
export type CallKind = Task | 'feedback_rewrite';
export type Provider = 'openrouter' | 'openai_compatible' | 'mock';
export type EvalStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Lane = 'realtime' | 'deferred';
export type Decision = 'accepted' | 'adjusted' | 'rejected';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
export type BillingModel = 'per_answer' | 'cost_plus';

export interface Me {
  id: string;
  email: string;
  name: string;
  /** PUBLIC_URL of the API, when the server sets it. */
  publicUrl?: string | null;
}

export interface Prices {
  input: number;
  cachedInput: number;
  output: number;
}

export interface Routing {
  only: string[];
  quantizations: string[];
  zdr: boolean;
  allowFallbacks: boolean;
  sort: 'price' | 'throughput' | 'latency' | null;
}

export interface Profile {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  routing: Routing | null;
  reasoning: 'off' | 'low' | 'medium' | 'high';
  temperature: number;
  seed: number | null;
  maxOutputTokens: number;
  timeoutMs: number;
  jsonMode: 'json_schema' | 'json_object';
  prices: Prices;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  usedFor: Task[];
  last30d: { calls: number; failed: number; costUsd: number; avgLatencyMs: number | null; p95LatencyMs: number | null };
}

export interface ModelsResponse {
  production: boolean;
  assignments: Partial<Record<Task, string>>;
  keys: { name: string; set: boolean; hint: string | null }[];
  profiles: Profile[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  prices: { input: number | null; cachedInput: number | null; output: number | null };
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
}

export interface OpenRouterHost {
  slug: string;
  name: string;
  tag: string | null;
  quantization: string | null;
  contextLength: number | null;
  maxOutputTokens: number | null;
  prices: { input: number | null; cachedInput: number | null; output: number | null };
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  status: number | null;
  uptime30m: number | null;
}

export type KeyInfo =
  | { configured: false; keyEnv: string | null }
  | { configured: true; keyEnv: string | null; valid: false; error: string }
  | {
      configured: true;
      keyEnv: string | null;
      valid: true;
      label: string | null;
      usageUsd: number | null;
      limitUsd: number | null;
      limitRemainingUsd: number | null;
      isFreeTier: boolean;
      credits: { totalUsd: number | null; usedUsd: number | null } | null;
    };

export interface Plan {
  id: string;
  name: string;
  currency: string;
  billingModel: BillingModel;
  monthlyFee: number;
  includedAnswers: number;
  pricePerAnswer: number;
  pricePerRubricDraft: number;
  markupPercent: number;
  chargeBlank: boolean;
  chargeReused: boolean;
  taxPercent: number;
  notes: string | null;
  archived: boolean;
  clients?: number;
}

export interface Client {
  id: string;
  name: string;
  /** First 4 characters of the key, the rest masked. */
  apiKeyHint: string | null;
  apiKeyStored: boolean;
  webhookUrl: string | null;
  lastSeenAt: string | null;
  monthlyBudgetUsd: number | null;
  active: boolean;
  planId: string | null;
  plan: { id: string; name: string; currency: string } | null;
  contactName: string | null;
  contactEmail: string | null;
  billingAddress: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  month?: { answers: number; failed: number; costUsd: number; revenue: number | null };
}

export interface UsageCounts {
  completed: number;
  blank: number;
  reused: number;
  failed: number;
  rubricDrafts: number;
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
  cost: number;
  margin: number;
  marginPercent: number | null;
}

export interface Webhook {
  id: string;
  clientId: string;
  clientName: string | null;
  evaluationId: string;
  event: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ClientDetail {
  client: Client;
  months: { month: string; usage: UsageCounts; charges: Charges | null }[];
  evaluations: Partial<Record<EvalStatus, number>>;
  webhooks: Webhook[];
  invoices: { id: string; number: string; month: string; status: InvoiceStatus; total: number; currency: string; periodStart: string }[];
}

export interface StatementRow {
  client: { id: string; name: string; active: boolean };
  plan: { id: string; name: string; currency: string; billingModel: BillingModel } | null;
  usage: UsageCounts;
  charges: Charges | null;
  invoice: { id: string; number: string; status: InvoiceStatus; total: number; currency: string } | null;
}

export interface Statements {
  month: string;
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  fxRates: Record<string, number>;
  rows: StatementRow[];
  totals: Record<string, { subtotal: number; tax: number; total: number; cost: number; margin: number }>;
  costUsd: number;
  consoleCostUsd: number;
}

export interface Parties {
  to: { name: string; organisation: string; email: string; address: string };
  from: { name: string; address: string; email: string; phone: string; paymentDetails: string; footer: string };
  plan: string;
  usage: UsageCounts;
  timeZone: string;
}

export interface Invoice {
  id: string;
  number: string;
  /** Billing month YYYY-MM. */
  month: string;
  clientId: string;
  clientName: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  parties: Parties;
  lines: InvoiceLine[];
  subtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
  costUsd: number;
  fxUsdRate: number | null;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface BillingSettings {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  paymentDetails: string;
  invoiceFooter: string;
  invoicePrefix: string;
  paymentTermsDays: number;
  timeZone: string;
  defaultCurrency: string;
  fxRates: Record<string, number>;
}

export interface UnitCosts {
  days: number;
  sample: { completed: number; aiMarked: number; blank: number; reused: number; failed: number; rubricDrafts: number };
  perMarkingCall: { calls: number; inputTokens: number | null; cachedTokens: number | null; outputTokens: number | null };
  costPerAnswerUsd: number | null;
  costPerRubricDraftUsd: number | null;
  blankShare: number | null;
  reuseShare: number | null;
  adjustRate: number | null;
  promptBaseTokens: number;
  markingProfile: { id: string | null; name: string; model: string; prices: Prices };
  rubricProfile: { id: string | null; name: string; model: string; prices: Prices };
}

export interface Overview {
  days: number;
  timeZone: string;
  totals: { completed: number; failed: number; blank: number; reused: number; costUsd: number; calls: number; estimatedCostShare: number };
  latency: { p50Ms: number | null; p95Ms: number | null };
  turnaround: { lane: Lane; p50Ms: number | null; p95Ms: number | null; count: number }[];
  agreement: {
    reviewed: number;
    accepted: number;
    adjusted: number;
    rejected: number;
    acceptRate: number | null;
    meanAbsDiff: number | null;
    meanAbsDiffShare: number | null;
  };
  daily: { day: string; completed: number; failed: number; costUsd: number; calls: number }[];
  byKind: { kind: CallKind; origin: 'client' | 'console'; calls: number; costUsd: number; inputTokens: number; outputTokens: number; cachedTokens: number }[];
  byModel: { model: string; host: string | null; calls: number; failed: number; costUsd: number; avgLatencyMs: number | null }[];
  byClient: { clientId: string; name: string; completed: number; costUsd: number }[];
  inFlight: { status: EvalStatus; lane: Lane; count: number }[];
  queues: Record<'realtime' | 'deferred' | 'webhooks', Record<string, number>>;
  webhooks: Partial<Record<'pending' | 'failed', number>>;
  month: {
    month: string;
    totals: Statements['totals'];
    costUsd: number;
    consoleCostUsd: number;
    fxRates: Record<string, number>;
  };
  models: Record<Task, { id: string | null; name: string; provider: Provider; model: string }>;
}

export interface Criterion {
  id: string;
  criterion: string;
  marks: number;
  awardWhen: string;
}

export interface Rubric {
  criteria: Criterion[];
}

export interface ScoredCriterion {
  id: string;
  criterion: string;
  max: number;
  awarded: number;
  reason: string;
}

export interface Highlight {
  start: number;
  end: number;
  quote: string;
  kind: 'strength' | 'weakness';
  criterionId: string | null;
  note: string;
}

export interface MarkingResult {
  suggestedScore: number;
  criteria: ScoredCriterion[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  highlights: Highlight[];
  missing: { criterionId: string | null; note: string }[];
  confidence: number | null;
  flags: string[];
}

export interface EvaluationRow {
  id: string;
  externalId: string;
  groupId: string | null;
  status: EvalStatus;
  lane: Lane;
  suggestedScore: number | null;
  maxMarks: number;
  confidence: number | null;
  flags: string[];
  decision: Decision | null;
  finalScore: number | null;
  model: string | null;
  error: string | null;
  reusedFromId: string | null;
  createdAt: string;
  completedAt: string | null;
  client: { id: string; name: string };
  question: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface LlmCall {
  id: string;
  kind: CallKind;
  origin: 'client' | 'console';
  model: string;
  host: string | null;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costEstimated: boolean;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export interface EvaluationDetail {
  evaluation: MarkingResult & {
    id: string;
    externalId: string;
    groupId: string | null;
    questionId: string;
    status: EvalStatus;
    lane: Lane;
    suggestedScore: number | null;
    maxMarks: number;
    answerText: string;
    model: string | null;
    host: string | null;
    promptVersion: string | null;
    reusedFromId: string | null;
    error: string | null;
    review: {
      decision: Decision;
      finalScore: number | null;
      finalCriteria: { id: string; awarded: number; max: number }[] | null;
      reviewedAt: string | null;
    } | null;
    createdAt: string;
    completedAt: string | null;
  };
  client: { id: string; name: string };
  question: { id: string; externalId: string | null; text: string; modelAnswer: string; maxMarks: number; markStep: number; rubric: Rubric };
  calls: LlmCall[];
  webhooks: Webhook[];
  costUsd: number;
}

export interface CallMeta {
  model: string;
  host: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number; costUsd: number };
  costEstimated: boolean;
  latencyMs: number;
  promptVersion: string;
}

interface MarkBase {
  profile: { id: string | null; name: string; provider: Provider; model: string };
  /** The normalised answer the highlight offsets refer to. */
  answer: string;
  maxMarks: number;
}

export type MarkResponse =
  | (MarkBase & { ok: true; result: MarkingResult; note?: string } & Partial<CallMeta> & {
        raw?: unknown;
        prompt?: { system: string; user: string };
      })
  | (MarkBase & { ok: false; error: string; raw?: unknown } & Partial<CallMeta>);

export type DraftResponse =
  | {
      ok: true;
      profile: { id: string | null; name: string; model: string };
      latencyMs: number;
      rubric: Rubric;
      notes: string;
      model: string;
      usage: { inputTokens: number; outputTokens: number; costUsd: number };
    }
  | { ok: false; profile: { id: string | null; name: string; model: string }; latencyMs: number; error: string; details: unknown };

export interface QueueStatus {
  key: 'realtime' | 'deferred' | 'webhooks';
  name: string;
  counts: Record<string, number>;
  paused: boolean;
  workers: number | null;
}

export interface SystemStatus {
  version: string;
  node: string;
  uptimeSec: number;
  db: string;
  redis: string;
  queues: QueueStatus[];
  promptVersions: Record<string, string>;
  config: Record<string, unknown>;
}

export interface FailedJob {
  id: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: string | null;
  finishedOn: string | null;
}

export interface Admin {
  id: string;
  email: string;
  name: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const TASK_LABEL: Record<Task, string> = {
  marking: 'Marking',
  rubric_draft: 'Rubric drafts',
};

export const CALL_KIND_LABEL: Record<CallKind, string> = {
  ...TASK_LABEL,
  feedback_rewrite: 'Feedback rewrites (retired)',
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  openai_compatible: 'OpenAI-compatible',
  mock: 'Mock',
};

export type LeadKind = 'pilot' | 'demo' | 'partner' | 'contact';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'closed' | 'spam';

export interface Lead {
  id: string;
  kind: LeadKind;
  status: LeadStatus;
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
  website: string | null;
  role: string | null;
  country: string | null;
  size: string | null;
  message: string;
  sourcePage: string | null;
  note: string | null;
  contactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadList extends Paged<Lead> {
  counts: Record<LeadStatus, number>;
}
