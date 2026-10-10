import type { LlmProvider, ModelProfile } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { LlmUsage } from './llm.types';

export const REASONING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];

export const JSON_MODES = ['json_schema', 'json_object'] as const;
export type JsonMode = (typeof JSON_MODES)[number];

export const ROUTING_SORTS = ['price', 'throughput', 'latency'] as const;

export const MOCK_MODEL = 'mock/keyword-overlap';
export const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Only variables named like `*_API_KEY` can be used as a profile's key. A profile names the
 * variable, never holds the key, and can't be pointed at unrelated secrets such as DATABASE_URL.
 */
export const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,58}_API_KEY$/;

export const routingSchema = z.object({
  only: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  quantizations: z.array(z.string().trim().min(1).max(16)).max(10).default([]),
  zdr: z.boolean().default(true),
  allowFallbacks: z.boolean().default(true),
  sort: z.enum(ROUTING_SORTS).nullable().default(null),
});
export type OpenRouterRouting = z.infer<typeof routingSchema>;

/** USD per 1M tokens. A cached-input price of 0 means "no cache discount". */
export interface Prices {
  input: number;
  cachedInput: number;
  output: number;
}

/** Everything needed to call one model, after defaults are applied. */
export interface ResolvedProfile {
  /** null for the built-in profile made from .env when the database has none. */
  id: string | null;
  name: string;
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKeyEnv: string | null;
  routing: OpenRouterRouting | null;
  reasoning: Reasoning;
  temperature: number;
  seed: number | null;
  maxOutputTokens: number;
  timeoutMs: number;
  jsonMode: JsonMode;
  prices: Prices;
}

/** The profile described by the LLM_* / OPENROUTER_* / PRICE_* variables. Seeds the first saved profile. */
export function envProfile(env: Env): ResolvedProfile {
  const openrouter = env.LLM_PROVIDER === 'openrouter';
  return {
    id: null,
    name: openrouter ? `${env.OPENROUTER_MODEL} (OpenRouter)` : 'Mock marker (development)',
    provider: env.LLM_PROVIDER,
    model: openrouter ? env.OPENROUTER_MODEL : MOCK_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL,
    apiKeyEnv: openrouter ? OPENROUTER_KEY_ENV : null,
    routing: openrouter
      ? {
          only: env.OPENROUTER_PROVIDERS,
          quantizations: env.OPENROUTER_QUANTIZATIONS,
          zdr: env.OPENROUTER_ZDR,
          allowFallbacks: true,
          sort: null,
        }
      : null,
    reasoning: env.OPENROUTER_REASONING,
    temperature: env.LLM_TEMPERATURE,
    seed: env.LLM_SEED,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: env.LLM_TIMEOUT_MS,
    jsonMode: 'json_schema',
    prices: {
      input: env.PRICE_INPUT_PER_MTOK,
      cachedInput: env.PRICE_CACHED_INPUT_PER_MTOK,
      output: env.PRICE_OUTPUT_PER_MTOK,
    },
  };
}

const asReasoning = (v: string): Reasoning => ((REASONING_LEVELS as readonly string[]).includes(v) ? (v as Reasoning) : 'off');
const asJsonMode = (v: string): JsonMode => ((JSON_MODES as readonly string[]).includes(v) ? (v as JsonMode) : 'json_schema');

export function fromRow(row: ModelProfile): ResolvedProfile {
  const routing = row.provider === 'openrouter' ? routingSchema.safeParse(row.routing ?? {}) : null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl || OPENROUTER_BASE_URL,
    apiKeyEnv: row.apiKeyEnv,
    routing: routing?.success ? routing.data : routing ? routingSchema.parse({}) : null,
    reasoning: asReasoning(row.reasoning),
    temperature: row.temperature,
    seed: row.seed,
    maxOutputTokens: row.maxOutputTokens,
    timeoutMs: row.timeoutMs,
    jsonMode: asJsonMode(row.jsonMode),
    prices: {
      input: Number(row.inputPricePerMTok),
      cachedInput: Number(row.cachedInputPricePerMTok),
      output: Number(row.outputPricePerMTok),
    },
  };
}

/** Column values for saving a resolved profile (used when seeding from .env). */
export function toRowData(p: ResolvedProfile) {
  return {
    name: p.name,
    provider: p.provider,
    model: p.model,
    baseUrl: p.provider === 'mock' ? null : p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    routing: p.routing ?? undefined,
    reasoning: p.reasoning,
    temperature: p.temperature,
    seed: p.seed,
    maxOutputTokens: p.maxOutputTokens,
    timeoutMs: p.timeoutMs,
    jsonMode: p.jsonMode,
    inputPricePerMTok: p.prices.input,
    cachedInputPricePerMTok: p.prices.cachedInput,
    outputPricePerMTok: p.prices.output,
  };
}

/** Cost in USD from token counts and per-1M prices. Cached input tokens use the cache price. */
export function estimateCostUsd(usage: Pick<LlmUsage, 'inputTokens' | 'cachedTokens' | 'outputTokens'>, prices: Prices): number {
  const cachedPrice = prices.cachedInput > 0 ? prices.cachedInput : prices.input;
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  return (uncached * prices.input + cached * cachedPrice + usage.outputTokens * prices.output) / 1e6;
}

/** The key for a profile, read from the environment variable it names. */
export function apiKeyFor(p: ResolvedProfile): string | undefined {
  if (!p.apiKeyEnv || !API_KEY_ENV_PATTERN.test(p.apiKeyEnv)) return undefined;
  const v = process.env[p.apiKeyEnv];
  return v && v.trim() ? v.trim() : undefined;
}
