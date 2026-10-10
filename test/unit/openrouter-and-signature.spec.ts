import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../../src/config/env';
import { LlmError, type LlmRequest } from '../../src/llm/llm.types';
import { OpenRouterClient } from '../../src/llm/openrouter.client';
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

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouterClient', () => {
  const client = new OpenRouterClient(env);

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

  it('treats non-JSON or empty content as a retryable bad response', async () => {
    expect((await failing(200, { choices: [{ message: { content: 'not json' } }] })).code).toBe('bad_response');
    const truncated = await failing(200, { choices: [{ finish_reason: 'length', message: { content: '' } }] });
    expect(truncated.message).toContain('token limit');
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
