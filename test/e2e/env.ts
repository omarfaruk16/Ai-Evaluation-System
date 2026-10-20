// Imported first by e2e specs: settings must be in place before the app modules load.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://ams:ams_dev_password@localhost:5440/ams_test?schema=public';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390/1';

Object.assign(process.env, {
  ENV_FILE: '.env.e2e-none',
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  LLM_PROVIDER: 'mock',
  LOG_LEVEL: 'error',
  TRUST_PROXY: 'false',
  MAX_ANSWER_CHARS: '500',
  MARKING_BACKOFF_MS: '150',
  REALTIME_RATE_MAX: '1000',
  DEFERRED_RATE_MAX: '1000',
  ROUTER_SMALL_GROUP_MAX: '3',
  ROUTER_FIRST_N_REALTIME: '1',
  WEBHOOK_MAX_ATTEMPTS: '3',
  // Lets the alert-email test store a mail password, and accept its throwaway self-signed TLS certificate.
  SECRETS_ENCRYPTION_KEY: 'e2e-test-secrets-key-0123456789abcdef',
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
});
