/**
 * Shows only the first characters of a secret: "ams_9xK2…" → "ams_************".
 * Used wherever a key, secret or token is displayed, so the full value never reaches a screen.
 */
export function maskSecret(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.slice(0, visible) + '*'.repeat(Math.min(16, Math.max(8, v.length - visible)));
}
