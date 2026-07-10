/**
 * In-memory login rate limiter (extracted from the admin/session route so it
 * can be unit-tested in isolation — G-3).
 *
 * Adequate for single-instance self-host (the target deployment): it resets on
 * server restart and does not span worker processes. For multi-instance
 * deployments, do per-IP limiting in the reverse proxy and set TRUSTED_PROXY=true
 * so the app trusts a rewritten X-Forwarded-For / X-Real-IP; a Redis-backed
 * limiter is the heavier alternative.
 *
 * Two caps by design:
 *  - MAX_LOGIN_ATTEMPTS (strict) gates a single IDENTITY bucket — one email, or
 *    one real IP behind a trusted proxy. This is the authoritative per-account
 *    brute-force gate.
 *  - GLOBAL_MAX_ATTEMPTS (forgiving) gates the SHARED 'global' bucket used only
 *    when TRUSTED_PROXY is unset (per-IP limiting is impossible, so every request
 *    lands in one bucket). A strict cap here was a DoS lever: 10 failed attempts
 *    from anyone locked out every user for the whole window. It is now a backstop
 *    against a mass credential-stuffing flood only.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const MAX_LOGIN_ATTEMPTS = 10
export const GLOBAL_MAX_ATTEMPTS = 100

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

/**
 * Records an attempt against `key` and reports whether it now exceeds `max`
 * within the rolling window. The window resets per key once it lapses.
 */
export function isLoginRateLimited(key: string, max: number = MAX_LOGIN_ATTEMPTS): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)

  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now })
    return false
  }

  entry.count++
  return entry.count > max
}

/** Clears a key's bucket — called on a successful login for that identity. */
export function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key)
}

/** Test-only: wipe all buckets so cases don't leak state into one another. */
export function resetLoginRateLimit(): void {
  loginAttempts.clear()
}
