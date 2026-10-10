import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The canonical form of a student answer. Highlight offsets refer to this exact string, and the
 * API returns it as `answerText`, so clients render highlights on the same text. NFC matters for
 * Bangla, where the same visible text can be encoded in more than one way.
 */
export function canonicalAnswer(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function isBlankAnswer(text: string): boolean {
  return canonicalAnswer(text).replace(/[\s\p{P}]/gu, '').length === 0;
}

/** Stable JSON: object keys sorted, so equal content always hashes the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Rounds to the nearest multiple of `step` and removes floating-point noise (1.5000000002 → 1.5). */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return Number(value.toFixed(4));
  return Number((Math.round(value / step) * step).toFixed(4));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
