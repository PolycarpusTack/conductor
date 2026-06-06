import { NextResponse } from 'next/server'
import { z } from 'zod'

import { assertSameOrigin } from '@/lib/csrf'
import { getAdminConfig, setSessionTtlHours } from '@/lib/server/admin-config'
import { requireRole } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'

const configSchema = z.object({
  sessionTtlHours: z.number().int().min(1).max(720),
})

/** GET /api/admin/security/config — current instance security settings. */
export const GET = withErrorHandling('api/admin/security/config', async () => {
  const unauthorized = await requireRole('admin')
  if (unauthorized) return unauthorized

  const config = await getAdminConfig()
  return NextResponse.json({
    sessionTtlHours: config.sessionTtlHours,
    passwordSource: config.passwordHash ? 'database' : 'environment',
  })
})

/** PUT /api/admin/security/config — update session TTL (applies to new sessions). */
export const PUT = withErrorHandling('api/admin/security/config', async (request: Request) => {
  const unauthorized = await requireRole('admin')
  if (unauthorized) return unauthorized
  assertSameOrigin(request)

  const parsed = configSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'sessionTtlHours must be 1-720')
  }

  await setSessionTtlHours(parsed.data.sessionTtlHours)
  return NextResponse.json({ success: true, sessionTtlHours: parsed.data.sessionTtlHours })
})
