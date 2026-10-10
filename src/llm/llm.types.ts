import type { LlmCallKind } from '@prisma/client';
import type { Rubric } from '../marking/schemas';

/** Structured inputs alongside the prompt text. Real models read the prompt; the mock reads these. */
export type LlmContext =
  | { kind: 'marking'; rubric: Rubric; answer: string; markStep: number }
  | {
      kind: 'rubric_draft';
      modelAnswer: string;
      maxMarks: number;
      markStep: number;
      maxCriteria: number;
    }
  | {
      kind: 'feedback_rewrite';
      rubric: Rubric;
      finalCriteria: { id: string; awarded: number; max: number }[];
    };

export interface LlmRequest {
  kind: LlmCallKind;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  context: LlmContext;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** USD as reported by the provider, or estimated from configured prices. */
  costUsd: number;
}

export interface LlmResult {
  data: unknown;
  model: string;
  host: string | null;
  usage: LlmUsage;
  latencyMs: number;
}

export type LlmErrorCode =
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'provider_error'
  | 'bad_response'
  | 'payment_required'
  | 'invalid_request'
  | 'auth_failed';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: LlmErrorCode,
    readonly retryable: boolean,
    readonly extra: {
      status?: number;
      retryAfterMs?: number;
      usage?: LlmUsage;
      model?: string;
      host?: string | null;
      latencyMs?: number;
    } = {},
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export const emptyUsage = (): LlmUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
});

/** The one place the rest of the service depends on. Swap models or providers behind it. */
export abstract class LlmClient {
  abstract readonly provider: string;
  abstract readonly model: string;
  abstract complete(req: LlmRequest): Promise<LlmResult>;
}
