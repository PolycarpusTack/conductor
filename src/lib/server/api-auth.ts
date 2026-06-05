import { NextResponse } from 'next/server'

import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { extractBearerToken } from '@/lib/server/api-keys'
import { validateApiKey } from '@/lib/server/scoped-api-keys'

/**
 * Authorizes a request via EITHER a scoped API key (Bearer) or the admin
 * session cookie. Built for integration endpoints (CI, scripts, webhooks)
 * that shouldn't require a browser session.
 *
 * - A presented Bearer token is authoritative: it must be a valid, unrevoked
 *   scoped key granting `scope` — no silent fallback to the session.
 * - Without a token, the admin session is required, and for mutating scopes
 *   the CSRF origin check applies (cookie auth only — key-authenticated
 *   clients aren't riding ambient browser credentials).
 *
 * Returns null when authorized, or the error response to send.
 */
export async function requireAdminOrScopedKey(
  request: Request,
  scope: string,
): Promise<NextResponse | null> {
  const bearer = extractBearerToken(request)
  if (bearer) {
    const key = await validateApiKey(bearer, scope)
    if (key) return null
    return NextResponse.json(
      { error: `Invalid, revoked, or insufficiently scoped API key (requires "${scope}")` },
      { status: 401 },
    )
  }

  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  if (scope !== 'read') assertSameOrigin(request) // throws ApiError(403)
  return null
}
