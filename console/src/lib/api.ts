// Fetch wrapper for /admin-api: sends the session cookie and the console header (CSRF guard),
// and turns { error: { code, message, details } } responses into ApiError.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Called when any request comes back 401 (session expired or signed out elsewhere). */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/admin-api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-AMS-Console': '1',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/login')) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? 'error', err?.details);
  }
  return data as T;
}

export const get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

/** Human message for an error, including field problems from a 400. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = Array.isArray(e.details)
      ? (e.details as { path?: string; message?: string }[])
          .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
          .filter(Boolean)
          .join('; ')
      : '';
    return details ? `${e.message} — ${details}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
