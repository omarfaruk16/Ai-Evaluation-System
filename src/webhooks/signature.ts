import { createHmac, timingSafeEqual } from 'node:crypto';

// Header format, Stripe-style: `X-AMS-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the
// HMAC is computed over `${t}.${rawBody}` with the client's webhook secret.

export const SIGNATURE_HEADER = 'x-ams-signature';

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export function signatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/** Reference verifier for client projects (copied into docs/API.md). */
export function verifySignature(
  secret: string,
  body: string,
  header: string | undefined,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(computeSignature(secret, t, body), 'hex');
  const given = Buffer.from(v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
