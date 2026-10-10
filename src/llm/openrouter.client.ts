import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import { emptyUsage, LlmClient, LlmError, type LlmRequest, type LlmResult, type LlmUsage } from './llm.types';

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

/**
 * Calls OpenRouter's OpenAI-compatible chat API with pinned hosts, fp8 weights, zero data
 * retention and strict JSON output. Every request uses the same routing, so all students are
 * marked by the same model build.
 */
export class OpenRouterClient extends LlmClient {
  readonly provider = 'openrouter';
  readonly model: string;
  private readonly logger = new Logger(OpenRouterClient.name);

  constructor(private readonly env: Env) {
    super();
    this.model = env.OPENROUTER_MODEL;
  }

  private routing(): Record<string, unknown> {
    const env = this.env;
    return {
      ...(env.OPENROUTER_PROVIDERS.length > 0 ? { only: env.OPENROUTER_PROVIDERS } : {}),
      ...(env.OPENROUTER_QUANTIZATIONS.length > 0 ? { quantizations: env.OPENROUTER_QUANTIZATIONS } : {}),
      ...(env.OPENROUTER_ZDR ? { zdr: true } : {}),
      data_collection: 'deny',
      require_parameters: true,
      allow_fallbacks: true,
    };
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const env = this.env;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema },
      },
      provider: this.routing(),
      temperature: env.LLM_TEMPERATURE,
      seed: env.LLM_SEED,
      max_tokens: req.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS,
      reasoning:
        env.OPENROUTER_REASONING === 'off'
          ? { enabled: false }
          : { effort: env.OPENROUTER_REASONING, exclude: true },
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
      'X-Title': env.OPENROUTER_APP_NAME,
    };
    if (env.OPENROUTER_APP_URL) headers['HTTP-Referer'] = env.OPENROUTER_APP_URL;

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      throw new LlmError(
        aborted ? `LLM request timed out after ${env.LLM_TIMEOUT_MS} ms` : `Network error: ${(e as Error).message}`,
        aborted ? 'timeout' : 'network',
        true,
        { latencyMs: Date.now() - started, model: this.model },
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
    const meta = { status: res.status, usage, model: json?.model ?? this.model, host: json?.provider ?? null, latencyMs };

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
