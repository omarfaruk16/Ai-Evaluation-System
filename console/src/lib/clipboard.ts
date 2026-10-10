/**
 * Copies text: the Clipboard API first, then the older execCommand route (works where the API
 * is blocked, e.g. some embedded browsers). `near` keeps the temporary textarea inside an open
 * dialog, whose focus trap would otherwise pull focus away. Returns whether it worked.
 */
export async function copyText(text: string, near?: Element | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the fallback
  }
  const host = near ?? document.body;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  host.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
