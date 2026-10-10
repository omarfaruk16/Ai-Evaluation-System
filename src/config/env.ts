import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4200),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TRUST_PROXY: bool.default('true'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    RUN_EMBEDDED_WORKERS: bool.default('false'),

    LLM_PROVIDER: z.enum(['openrouter', 'mock']).default('mock'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
    LLM_SEED: z.coerce.number().int().default(7),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2_000),

    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    OPENROUTER_MODEL: z.string().default('deepseek/deepseek-v4-flash-0731'),
    OPENROUTER_PROVIDERS: csv.default('deepinfra,parasail'),
    OPENROUTER_QUANTIZATIONS: csv.default('fp8'),
    OPENROUTER_ZDR: bool.default('true'),
    OPENROUTER_REASONING: z.enum(['off', 'low', 'high']).default('off'),
    OPENROUTER_APP_URL: z.string().url().optional(),
    OPENROUTER_APP_NAME: z.string().default('AI Marking Service'),

    // Used only when the provider doesn't report cost (the mock adapter), in USD per 1M tokens.
    PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0.06),
    PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0.18),

    REALTIME_CONCURRENCY: z.coerce.number().int().positive().default(20),
    REALTIME_RATE_MAX: z.coerce.number().int().positive().default(30),
    DEFERRED_CONCURRENCY: z.coerce.number().int().positive().default(10),
    DEFERRED_RATE_MAX: z.coerce.number().int().positive().default(5),
    RATE_DURATION_MS: z.coerce.number().int().positive().default(1_000),
    MARKING_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),

    ROUTER_FIRST_N_REALTIME: z.coerce.number().int().min(0).default(20),
    ROUTER_SMALL_GROUP_MAX: z.coerce.number().int().min(0).default(300),
    ROUTER_REALTIME_MAX_WAITING: z.coerce.number().int().positive().default(1_000),

    MAX_ANSWERS_PER_REQUEST: z.coerce.number().int().positive().default(500),
    MAX_ANSWER_CHARS: z.coerce.number().int().positive().default(20_000),
    MAX_HIGHLIGHTS: z.coerce.number().int().positive().default(8),

    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'openrouter' && !env.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENROUTER_API_KEY'],
        message: 'OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter',
      });
    }
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_PROVIDER'],
        message: 'The mock LLM provider is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
