import { forbidden } from '@/lib/server/api-errors'

/**
 * Defense-in-depth CSRF guard for session-authenticated mutation routes.
 *
 * `SameSite=Lax` on the admin session cookie already blocks cross-site form
 * POSTs in modern browsers, but it does not cover older browsers or every
 * navigation case. An explicit origin/host comparison closes that gap.
 *
 * Requests without an `Origin` header (curl, server-to-server, agents using
 * API keys) pass through — they are not riding a browser session cookie.
 *
 * Throws `ApiError(403)` so `withErrorHandling` turns a mismatch into a
 * clean JSON response.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (!origin) return // non-browser clients send no Origin header

  const host = request.headers.get('host')
  if (!host) return // shouldn't happen in practice

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw forbidden('Cross-origin request blocked')
  }

  if (originHost !== host) {
    throw forbidden('Cross-origin request blocked')
  }
}
