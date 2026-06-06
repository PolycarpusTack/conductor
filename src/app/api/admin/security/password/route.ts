import { NextResponse } from 'next/server'
import { z } from 'zod'

import { assertSameOrigin } from '@/lib/csrf'
import { setAdminPassword } from '@/lib/server/admin-config'
import { requireRole, verifyAdminPassword } from '@/lib/server/admin-session'
import { badRequest, unauthorized as unauthorizedError, withErrorHandling } from '@/lib/server/api-errors'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})

/**
 * POST /api/admin/security/password — change the admin password (Epic S2).
 * The new password is stored as a scrypt hash in AdminConfig and overrides
 * the env var. Session tokens derive from the credential fingerprint, so
 * every session (including this one) is invalidated — the client re-logs in.
 */
export const POST = withErrorHandling('api/admin/security/password', async (request: Request) => {
  const unauthorized = await requireRole('admin')
  if (unauthorized) return unauthorized
  assertSameOrigin(request)

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid payload')
  }

  if (!(await verifyAdminPassword(parsed.data.currentPassword))) {
    throw unauthorizedError('Current password is incorrect')
  }

  await setAdminPassword(parsed.data.newPassword)

  return NextResponse.json({ success: true, note: 'All sessions invalidated — sign in again.' })
})
