import { randomBytes } from 'node:crypto';
import { open, seal } from '../common/secret-box';
import { sha256 } from '../common/text';

const KEY_PURPOSE = 'client-api-key';

/** The key sealed for storage, or null when no SECRETS_ENCRYPTION_KEY is configured. */
export function sealApiKey(key: string, encryptionKey: string | undefined): string | null {
  return encryptionKey ? seal(key, encryptionKey, KEY_PURPOSE) : null;
}

export function openApiKey(sealed: string, encryptionKey: string): string | null {
  return open(sealed, encryptionKey, KEY_PURPOSE);
}

/** API keys are 256-bit random secrets; authentication uses their SHA-256. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `ams_${randomBytes(32).toString('base64url')}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

export function hashApiKey(key: string): string {
  return sha256(key.trim());
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}
