/**
 * Shows only the first characters of a secret: "ams_9xK2…" → "ams_************".
 * Secrets are never displayed in full; copy buttons copy the real value.
 */
export function maskSecret(value: string | null | undefined, visible = 4): string {
  if (!value) return '';
  const v = value.trim();
  return v.slice(0, visible) + '*'.repeat(Math.min(16, Math.max(8, v.length - visible)));
}
