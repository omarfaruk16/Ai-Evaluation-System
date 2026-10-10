import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../../src/config/env';
import { ChatCompletionsClient } from '../../src/llm/chat-completions.client';
import { priceUsage } from '../../src/llm/llm.router';
import { LlmError, type LlmRequest } from '../../src/llm/llm.types';
import { envProfile, estimateCostUsd, type ResolvedProfile } from '../../src/llm/profile';
import { signatureHeader, verifySignature } from '../../src/webhooks/signature';

const env = validateEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'sk-test',
});

const req: LlmRequest = {
  kind: 'marking',
  system: 'sys',
  user: 'usr',
  schemaName: 'marking_result',
  jsonSchema: { type: 'object' },
  context: { kind: 'marking', rubric: { criteria: [] }, answer: 'a', markStep: 0.5 },
};

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const profile = envProfile(env);

describe('ChatCompletionsClient (OpenRouter profile)', () => {
  const adapter = new ChatCompletionsClient({ name: 'test' });
  const client = { complete: (r: LlmRequest) => adapter.complete(profile, r) };
  beforeEach(() => vi.stubEnv('OPENROUTER_API_KEY', 'sk-test'));

  it('sends pinned hosts, fp8, zero retention, strict JSON and reasoning off', async () => {
    const fn = mockFetch(200, {
      model: 'deepseek/deepseek-v4-flash-0731',
      provider: 'DeepInfra',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        cost: 0.00001,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    });
    const res = await client.complete(req);
    const sent = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(sent.provider).toEqual({
      only: ['deepinfra', 'parasail'],
      quantizations: ['fp8'],
      zdr: true,
      data_collection: 'deny',
      require_parameters: true,
      allow_fallbacks: true,
    });
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.reasoning).toEqual({ enabled: false });
    expect(sent.temperature).toBe(0);
    expect(res.data).toEqual({ ok: true });
    expect(res.host).toBe('DeepInfra');
    expect(res.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedTokens: 60, costUsd: 0.00001 });
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    mockFetch(200, { choices: [{ message: { content: '```json\n{"a":1}\n```' } }] });
    expect((await client.complete(req)).data).toEqual({ a: 1 });
  });

  const failing = async (status: number, body: unknown, headers?: Record<string, string>) => {
    mockFetch(status, body, headers);
    try {
      await client.complete(req);
    } catch (e) {
      return e as LlmError;
    }
    throw new Error('expected an error');
  };

  it('maps 429 to a retryable rate limit with retry-after', async () => {
    const e = await failing(429, { error: { message: 'slow down' } }, { 'retry-after': '7' });
    expect(e.code).toBe('rate_limited');
    expect(e.retryable).toBe(true);
    expect(e.extra.retryAfterMs).toBe(7000);
  });

  it('maps 402, 401, 500 and 400', async () => {
    expect((await failing(402, {})).code).toBe('payment_required');
    const auth = await failing(401, {});
    expect(auth.code).toBe('auth_failed');
    expect(auth.retryable).toBe(false);
    expect((await failing(503, {})).retryable).toBe(true);
    const bad = await failing(400, { error: { message: 'bad schema' } });
    expect(bad.code).toBe('invalid_request');
    expect(bad.retryable).toBe(false);
  });

  it('refuses to call without a key in the named variable', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const e = await failing(200, {});
    expect(e.code).toBe('auth_failed');
    expect(e.message).toContain('OPENROUTER_API_KEY');
  });

  it('treats non-JSON or empty content as a retryable bad response', async () => {
    expect((await failing(200, { choices: [{ message: { content: 'not json' } }] })).code).toBe('bad_response');
    const truncated = await failing(200, { choices: [{ finish_reason: 'length', message: { content: '' } }] });
    expect(truncated.message).toContain('token limit');
  });
});

describe('ChatCompletionsClient (other OpenAI-compatible APIs)', () => {
  const other: ResolvedProfile = {
    ...profile,
    provider: 'openai_compatible',
    baseUrl: 'https://api.example.com/v1/',
    apiKeyEnv: 'EXAMPLE_API_KEY',
    jsonMode: 'json_object',
    reasoning: 'low',
    seed: null,
  };

  it('uses JSON mode with the schema in the prompt and no OpenRouter routing', async () => {
    vi.stubEnv('EXAMPLE_API_KEY', 'k');
    const fn = mockFetch(200, { choices: [{ message: { content: '{"x":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const res = await new ChatCompletionsClient({ name: 't' }).complete(other, req);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.messages[0].content).toContain('JSON Schema');
    expect(sent.provider).toBeUndefined();
    expect(sent.seed).toBeUndefined();
    expect(sent.reasoning_effort).toBe('low');
    expect(res.usage.costUsd).toBe(0);
  });

  it('only reads keys from *_API_KEY variables', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://secret');
    mockFetch(200, {});
    const e = await new ChatCompletionsClient({ name: 't' })
      .complete({ ...other, apiKeyEnv: 'DATABASE_URL' }, req)
      .catch((x: LlmError) => x);
    expect((e as LlmError).code).toBe('auth_failed');
  });
});

describe('cost', () => {
  const prices = { input: 0.3, cachedInput: 0.03, output: 1.2 };

  it('prices cached input at the cache rate, or the input rate when none is set', () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 100_000 };
    expect(estimateCostUsd(usage, prices)).toBeCloseTo(0.6 * 0.3 + 0.4 * 0.03 + 0.1 * 1.2, 10);
    expect(estimateCostUsd(usage, { ...prices, cachedInput: 0 })).toBeCloseTo(0.3 + 0.12, 10);
  });

  it('keeps a reported cost and estimates a missing one', () => {
    const p = { ...profile, prices };
    const reported = priceUsage({ inputTokens: 10, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, costUsd: 0.5 }, p);
    expect(reported).toMatchObject({ costEstimated: false, usage: { costUsd: 0.5 } });
    const estimated = priceUsage({ inputTokens: 1000, outputTokens: 1000, cachedTokens: 0, reasoningTokens: 0, costUsd: 0 }, p);
    expect(estimated.costEstimated).toBe(true);
    expect(estimated.usage.costUsd).toBeCloseTo(0.0015, 10);
    expect(priceUsage({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0 }, p).costEstimated).toBe(false);
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"1"}';

  it('verifies a valid signature', () => {
    const header = signatureHeader(secret, body, 1_000);
    expect(verifySignature(secret, body, header, 300, 1_100)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and an old timestamp', () => {
    const header = signatureHeader(secret, body, 1_000);
    expect(verifySignature(secret, '{"id":"2"}', header, 300, 1_000)).toBe(false);
    expect(verifySignature('other', body, header, 300, 1_000)).toBe(false);
    expect(verifySignature(secret, body, header, 300, 2_000)).toBe(false);
    expect(verifySignature(secret, body, undefined)).toBe(false);
  });
});

describe('environment validation', () => {
  it('requires an API key for OpenRouter and forbids the mock in production', () => {
    const base = { DATABASE_URL: 'postgresql://x:y@h:1/d', REDIS_URL: 'redis://h:1' };
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openrouter' })).toThrow(/OPENROUTER_API_KEY/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', LLM_PROVIDER: 'mock' })).toThrow(/mock/);
  });
});
