import { NextResponse } from 'next/server'

import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { extractBearerToken } from '@/lib/server/api-keys'
import { validateApiKey } from '@/lib/server/scoped-api-keys'

export type AuthOutcome =
  | { ok: true; via: 'session' }
  | { ok: true; via: 'key'; keyId: string }
  | { ok: false; response: NextResponse }

/**
 * Authorizes a request via EITHER a scoped API key (Bearer) or the admin
 * session cookie, reporting WHICH path authenticated — callers that treat
 * key-originated content as untrusted (content safety) need to know.
 *
 * - A presented Bearer token is authoritative: it must be a valid, unrevoked
 *   scoped key granting `scope` — no silent fallback to the session.
 * - Without a token, the admin session is required, and for mutating scopes
 *   the CSRF origin check applies (cookie auth only — key-authenticated
 *   clients aren't riding ambient browser credentials).
 */
export async function authorizeAdminOrScopedKey(
  request: Request,
  scope: string,
): Promise<AuthOutcome> {
  const bearer = extractBearerToken(request)
  if (bearer) {
    const key = await validateApiKey(bearer, scope)
    if (key) return { ok: true, via: 'key', keyId: key.id }
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Invalid, revoked, or insufficiently scoped API key (requires "${scope}")` },
        { status: 401 },
      ),
    }
  }

  const unauthorized = await requireAdminSession()
  if (unauthorized) return { ok: false, response: unauthorized }

  if (scope !== 'read') assertSameOrigin(request) // throws ApiError(403)
  return { ok: true, via: 'session' }
}

/** Convenience form: null when authorized, error response otherwise. */
export async function requireAdminOrScopedKey(
  request: Request,
  scope: string,
): Promise<NextResponse | null> {
  const outcome = await authorizeAdminOrScopedKey(request, scope)
  return outcome.ok ? null : outcome.response
}
