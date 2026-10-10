import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// AES-256-GCM for small secrets kept in the database (project API keys), keyed from
// SECRETS_ENCRYPTION_KEY so a database dump alone doesn't reveal them.

const VERSION = 'v1';

function key(serverSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, 'ai-marking-service', purpose, 32));
}

export function seal(plain: string, serverSecret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(serverSecret, purpose), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The plain text, or null if it can't be decrypted (different key or tampered value). */
export function open(sealed: string, serverSecret: string, purpose: string): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(serverSecret, purpose), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
