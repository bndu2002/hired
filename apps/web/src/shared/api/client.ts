/**
 * Thin fetch wrapper for the Hired server.
 *
 * Attaches the shared secret to every request so the server's
 * sharedSecret middleware lets us through. The secret is read from
 * Vite's env (VITE_HIRED_SHARED_SECRET) — see .env.example.
 *
 * In dev, the Vite proxy forwards /api/* to http://127.0.0.1:4000.
 * In packaged use (if we ever bundle for a desktop shell), the same
 * relative path still works because the server will be colocated.
 */

const SHARED_SECRET_HEADER = 'X-Hired-Secret';

function getSharedSecret(): string {
  const secret = import.meta.env.VITE_HIRED_SHARED_SECRET;
  if (!secret) {
    // Fail loud in dev — the server will 401 everything otherwise, which
    // is confusing to debug via DevTools alone.
    throw new Error(
      'VITE_HIRED_SHARED_SECRET not set. Add it to apps/web/.env.local.',
    );
  }
  return secret;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Fetch a JSON endpoint from the Hired server.
 *
 * - Throws ApiError on non-2xx so TanStack Query's error path triggers.
 * - Returns parsed JSON (callers narrow with Zod at the hook layer).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    [SHARED_SECRET_HEADER]: getSharedSecret(),
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  const response = await fetch(path, init);

  const contentType = response.headers.get('content-type') ?? '';
  const parsed: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${init.method} ${path} failed with ${response.status}`,
      parsed,
    );
  }

  return parsed as T;
}
