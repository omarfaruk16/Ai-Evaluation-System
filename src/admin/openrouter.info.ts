import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors';
import { maskSecret } from '../common/mask';
import { apiKeyFor, type ResolvedProfile } from '../llm/profile';

// Read-only lookups against OpenRouter's public API: key usage, model list, hosts and prices.
// None of these calls cost anything.

const TIMEOUT_MS = 10_000;
const MODELS_TTL_MS = 60 * 60_000;
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

/** OpenRouter quotes USD per token as strings; the console shows USD per 1M tokens. */
const perM = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Number((n * 1e6).toFixed(6)) : null;
};

async function getJson(url: string, key?: string): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    throw new AppError(
      'llm_unavailable',
      (e as Error).name === 'AbortError' ? 'OpenRouter did not answer in time' : `Could not reach OpenRouter: ${(e as Error).message}`,
      HttpStatus.BAD_GATEWAY,
    );
  } finally {
    clearTimeout(timer);
  }
}

const base = (p: { baseUrl: string }) => p.baseUrl.replace(/\/+$/, '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export interface ModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  prices: { input: number | null; cachedInput: number | null; output: number | null };
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
}

let modelsCache: { at: number; baseUrl: string; models: ModelSummary[] } | null = null;

export async function listModels(baseUrl: string, query: string): Promise<{ models: ModelSummary[]; total: number }> {
  if (!modelsCache || modelsCache.baseUrl !== baseUrl || Date.now() - modelsCache.at > MODELS_TTL_MS) {
    const { status, json } = await getJson(`${base({ baseUrl })}/models`);
    if (status !== 200) throw new AppError('llm_unavailable', `OpenRouter model list failed (HTTP ${status})`, HttpStatus.BAD_GATEWAY);
    const data = Array.isArray(obj(json).data) ? (obj(json).data as unknown[]) : [];
    const models = data.map((raw) => {
      const m = obj(raw);
      const pricing = obj(m.pricing);
      const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as string[]) : [];
      return {
        id: String(m.id ?? ''),
        name: String(m.name ?? m.id ?? ''),
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        prices: { input: perM(pricing.prompt), cachedInput: perM(pricing.input_cache_read), output: perM(pricing.completion) },
        supportsStructuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
        supportsReasoning: params.includes('reasoning'),
      };
    });
    modelsCache = { at: Date.now(), baseUrl, models: models.filter((m) => m.id) };
  }
  const q = query.trim().toLowerCase();
  const hits = q
    ? modelsCache.models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : modelsCache.models;
  return { models: hits.slice(0, 40), total: hits.length };
}

export interface HostSummary {
  /** Slug for `provider.only`, e.g. "deepinfra". */
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

/** Every host that serves a model on OpenRouter, with its own prices and quantization. */
export async function listHosts(baseUrl: string, model: string): Promise<{ model: string; name: string | null; hosts: HostSummary[] }> {
  if (!MODEL_ID.test(model)) throw new AppError('validation_failed', 'Model ids look like author/model-name', HttpStatus.BAD_REQUEST);
  const { status, json } = await getJson(`${base({ baseUrl })}/models/${model}/endpoints`);
  if (status === 404) throw new AppError('not_found', `OpenRouter has no model "${model}"`, HttpStatus.NOT_FOUND);
  if (status !== 200) throw new AppError('llm_unavailable', `OpenRouter host list failed (HTTP ${status})`, HttpStatus.BAD_GATEWAY);
  const data = obj(obj(json).data);
  const endpoints = Array.isArray(data.endpoints) ? (data.endpoints as unknown[]) : [];
  const hosts = endpoints.map((raw) => {
    const e = obj(raw);
    const pricing = obj(e.pricing);
    const params = Array.isArray(e.supported_parameters) ? (e.supported_parameters as string[]) : [];
    const name = String(e.provider_name ?? e.name ?? 'unknown');
    const tag = typeof e.tag === 'string' ? e.tag : null;
    return {
      slug: (tag?.split('/')[0] ?? name).toLowerCase().replace(/\s+/g, '-'),
      name,
      tag,
      quantization: typeof e.quantization === 'string' ? e.quantization : null,
      contextLength: typeof e.context_length === 'number' ? e.context_length : null,
      maxOutputTokens: typeof e.max_completion_tokens === 'number' ? e.max_completion_tokens : null,
      prices: { input: perM(pricing.prompt), cachedInput: perM(pricing.input_cache_read), output: perM(pricing.completion) },
      supportsStructuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
      supportsReasoning: params.includes('reasoning'),
      status: typeof e.status === 'number' ? e.status : null,
      uptime30m: typeof e.uptime_last_30m === 'number' ? e.uptime_last_30m : null,
    };
  });
  hosts.sort((a, b) => (a.prices.input ?? Infinity) - (b.prices.input ?? Infinity));
  return { model, name: typeof data.name === 'string' ? data.name : null, hosts };
}

/** Usage and limit of the API key a profile uses (OpenRouter /key and /credits). */
export async function keyInfo(p: ResolvedProfile) {
  const key = apiKeyFor(p);
  if (!key) {
    return { configured: false as const, keyEnv: p.apiKeyEnv };
  }
  const [keyRes, creditsRes] = await Promise.all([getJson(`${base(p)}/key`, key), getJson(`${base(p)}/credits`, key).catch(() => null)]);
  if (keyRes.status === 401 || keyRes.status === 403) {
    return { configured: true as const, keyEnv: p.apiKeyEnv, valid: false, error: 'OpenRouter rejected this key' };
  }
  if (keyRes.status !== 200) {
    return { configured: true as const, keyEnv: p.apiKeyEnv, valid: false, error: `OpenRouter answered HTTP ${keyRes.status}` };
  }
  const d = obj(obj(keyRes.json).data);
  const credits = creditsRes?.status === 200 ? obj(obj(creditsRes.json).data) : null;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    configured: true as const,
    keyEnv: p.apiKeyEnv,
    valid: true,
    // OpenRouter's label is a shortened key; show only its first characters.
    label: typeof d.label === 'string' ? maskSecret(d.label) : null,
    usageUsd: num(d.usage),
    limitUsd: num(d.limit),
    limitRemainingUsd: num(d.limit_remaining),
    isFreeTier: d.is_free_tier === true,
    credits: credits ? { totalUsd: num(credits.total_credits), usedUsd: num(credits.total_usage) } : null,
  };
}
