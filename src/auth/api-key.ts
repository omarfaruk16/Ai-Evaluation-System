import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/text';

/** API keys are 256-bit random secrets; only their SHA-256 is stored. */
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
