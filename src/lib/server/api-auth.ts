import { NextResponse } from 'next/server'

import { assertSameOrigin } from '@/lib/csrf'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { forbidden } from '@/lib/server/api-errors'
import { extractBearerToken } from '@/lib/server/api-keys'
import { getLogger } from '@/lib/server/logger'
import { validateApiKey } from '@/lib/server/scoped-api-keys'

const log = getLogger('api-auth')

export type AuthOutcome =
  | { ok: true; via: 'session' }
  | { ok: true; via: 'key'; keyId: string; projectId: string | null }
  | { ok: false; response: NextResponse }

/** The successful variants of {@link AuthOutcome}. */
export type Authorized = Extract<AuthOutcome, { ok: true }>

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
    if (key) return { ok: true, via: 'key', keyId: key.id, projectId: key.projectId }
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

/**
 * Project-binding enforcement for scoped keys (B-4).
 *
 * Call after auth succeeds, once the request's target project is known
 * (body/query/path). Admin-session auth is never project-restricted.
 *
 * - Key bound to another project → throws ApiError(403) (withErrorHandling
 *   turns it into a clean JSON response).
 * - Legacy unbound key (projectId null) → allowed instance-wide, but a
 *   deprecation warning is logged and written to the project's activity log
 *   (mirrors the content_safety_flagged convention).
 */
export function assertKeyProjectAccess(auth: Authorized, targetProjectId: string): void {
  if (auth.via !== 'key') return

  if (auth.projectId === null) {
    warnLegacyUnboundKey(auth.keyId, targetProjectId)
    return
  }

  if (auth.projectId !== targetProjectId) {
    throw forbidden('API key is not authorized for this project')
  }
}

/**
 * Deprecation signal for legacy instance-wide keys. Logged always; also
 * recorded as a warn-level activity entry when a target project is known
 * (fire-and-forget — enforcement must not block on it).
 */
export function warnLegacyUnboundKey(keyId: string, targetProjectId?: string): void {
  log.warn('legacy unbound scoped API key used — instance-wide keys are deprecated, bind the key to a project', {
    keyId,
    ...(targetProjectId ? { projectId: targetProjectId } : {}),
  })

  if (targetProjectId) {
    void db.activityLog
      .create({
        data: {
          action: 'scoped_key_unbound_deprecated',
          level: 'warn',
          component: 'system',
          projectId: targetProjectId,
          details: JSON.stringify({ keyId }),
        },
      })
      .catch(() => {})
  }
}
