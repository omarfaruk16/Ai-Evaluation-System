import { Logger } from '@nestjs/common';
import { emptyUsage, LlmError, type AdapterResult, type LlmAdapter, type LlmRequest, type LlmUsage } from './llm.types';
import { apiKeyFor, type OpenRouterRouting, type ResolvedProfile } from './profile';

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface OpenRouterResponse {
  model?: string;
  provider?: string;
  error?: { message?: string; code?: number | string };
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  usage?: OpenRouterUsage;
}

function parseUsage(u: OpenRouterUsage | undefined): LlmUsage {
  if (!u) return emptyUsage();
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    costUsd: typeof u.cost === 'number' ? u.cost : 0,
  };
}

/** Some hosts wrap JSON in a markdown fence even in JSON mode. */
function stripFences(s: string): string {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1]! : t;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** OpenRouter provider preferences: pinned hosts, quantization, zero data retention. */
export function routingBody(r: OpenRouterRouting | null): Record<string, unknown> {
  const routing = r ?? { only: [], quantizations: [], zdr: false, allowFallbacks: true, sort: null };
  return {
    ...(routing.only.length > 0 ? { only: routing.only } : {}),
    ...(routing.quantizations.length > 0 ? { quantizations: routing.quantizations } : {}),
    ...(routing.zdr ? { zdr: true } : {}),
    data_collection: 'deny',
    require_parameters: true,
    allow_fallbacks: routing.allowFallbacks,
    ...(routing.sort ? { sort: routing.sort } : {}),
  };
}

/**
 * Calls an OpenAI-compatible chat completions API with a model profile's settings. For
 * OpenRouter it adds pinned hosts, fp8, zero data retention and the reasoning switch, so every
 * student is marked by the same model build. Strict JSON schema output where the provider
 * supports it; otherwise JSON mode with the schema in the system prompt.
 */
export class ChatCompletionsClient implements LlmAdapter {
  private readonly logger = new Logger(ChatCompletionsClient.name);

  constructor(private readonly app: { name: string; url?: string }) {}

  async complete(p: ResolvedProfile, req: LlmRequest): Promise<AdapterResult> {
    const openrouter = p.provider === 'openrouter';
    const key = apiKeyFor(p);
    if (!key) {
      throw new LlmError(
        `No API key: set ${p.apiKeyEnv ?? 'an *_API_KEY variable'} in the service environment`,
        'auth_failed',
        false,
        { model: p.model },
      );
    }
    const system =
      p.jsonMode === 'json_object'
        ? `${req.system}\n\nThe JSON must match this JSON Schema:\n${JSON.stringify(req.jsonSchema)}`
        : req.system;
    const body: Record<string, unknown> = {
      model: p.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
      response_format:
        p.jsonMode === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } }
          : { type: 'json_object' },
      temperature: p.temperature,
      ...(p.seed !== null ? { seed: p.seed } : {}),
      max_tokens: req.maxOutputTokens ?? p.maxOutputTokens,
    };
    if (openrouter) {
      body.provider = routingBody(p.routing);
      body.reasoning = p.reasoning === 'off' ? { enabled: false } : { effort: p.reasoning, exclude: true };
    } else if (p.reasoning !== 'off') {
      body.reasoning_effort = p.reasoning;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (openrouter) {
      headers['X-Title'] = this.app.name;
      if (this.app.url) headers['HTTP-Referer'] = this.app.url;
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      throw new LlmError(
        aborted ? `LLM request timed out after ${p.timeoutMs} ms` : `Network error: ${(e as Error).message}`,
        aborted ? 'timeout' : 'network',
        true,
        { latencyMs: Date.now() - started, model: p.model },
      );
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - started;
    const raw = await res.text();
    let json: OpenRouterResponse | null = null;
    try {
      json = JSON.parse(raw) as OpenRouterResponse;
    } catch {
      json = null;
    }
    const usage = parseUsage(json?.usage);
    const meta = { status: res.status, usage, model: json?.model ?? p.model, host: json?.provider ?? null, latencyMs };

    if (!res.ok) {
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      const after = retryAfterMs(res.headers.get('retry-after'));
      if (res.status === 429) throw new LlmError(`Rate limited: ${message}`, 'rate_limited', true, { ...meta, retryAfterMs: after });
      if (res.status === 402) throw new LlmError(`Out of credits: ${message}`, 'payment_required', true, meta);
      if (res.status === 401 || res.status === 403) throw new LlmError(`Authentication failed: ${message}`, 'auth_failed', false, meta);
      if (res.status === 408 || res.status >= 500) throw new LlmError(`Provider error: ${message}`, 'provider_error', true, meta);
      throw new LlmError(`Request rejected: ${message}`, 'invalid_request', false, meta);
    }

    if (json?.error) {
      throw new LlmError(`Provider error: ${json.error.message ?? 'unknown'}`, 'provider_error', true, meta);
    }
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      const why = choice?.finish_reason === 'length' ? 'output hit the token limit' : 'empty response';
      throw new LlmError(`Unusable model output: ${why}`, 'bad_response', true, meta);
    }

    let data: unknown;
    try {
      data = JSON.parse(stripFences(content));
    } catch {
      this.logger.warn(`Model returned non-JSON content (${content.length} chars) from ${meta.host ?? 'unknown host'}`);
      throw new LlmError('Model output was not valid JSON', 'bad_response', true, meta);
    }

    return { data, model: meta.model, host: meta.host, usage, latencyMs };
  }
}
