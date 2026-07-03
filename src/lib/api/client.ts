/**
 * Typed request core for the AgentBoard REST API (E-2a).
 *
 * All browser-side calls go through `apiFetch`: it serializes JSON bodies,
 * sets the Content-Type header exactly like the previous per-site fetches,
 * and normalizes non-OK responses into a thrown `ApiClientError` whose
 * message follows the readApiError semantics the hooks used to duplicate
 * (`payload?.error || fallback`).
 *
 * Auth is session-cookie based; requests intentionally keep fetch's default
 * `same-origin` credentials, and CSRF is origin-checked server-side, so no
 * extra headers are added here.
 */

export class ApiClientError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

/** Per-call options accepted by every endpoint wrapper. */
export interface ApiCallOptions {
  /**
   * Message used when an error response carries no `error` field (or a
   * non-JSON body) — the readApiError fallback semantics.
   */
  errorFallback?: string
}

export interface ApiRequestInit {
  method?: string
  cache?: RequestCache
  headers?: Record<string, string>
  /** JSON-serializable request body. Sets `Content-Type: application/json`. */
  body?: unknown
  signal?: AbortSignal
  /** See {@link ApiCallOptions.errorFallback}. */
  errorFallback?: string
}

// Exactly the readApiError helper previously duplicated across the hooks.
async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json()
    return payload?.error || fallback
  } catch {
    return fallback
  }
}

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, headers, errorFallback, ...rest } = init
  const response = await fetch(path, {
    ...rest,
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }
      : headers
        ? { headers }
        : {}),
  })
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      await readApiError(response, errorFallback ?? `Request failed with status ${response.status}`),
    )
  }
  return response.json() as Promise<T>
}

/**
 * Resolves to `undefined` when the request failed with an API error response
 * — mirroring the old `if (res.ok) set(...)` guards that silently skipped
 * error responses. Network/parse errors still reject.
 */
export async function swallowApiClientError<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof ApiClientError) return undefined
    throw error
  }
}
