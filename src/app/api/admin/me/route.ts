import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { scryptHash, scryptVerify } from '@/lib/server/admin-config'
import { clearAdminSession, createAdminSession, getSessionUser, requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { changeMyPasswordSchema } from '@/lib/server/contracts'
import { revokeUserSessions } from '@/lib/server/user-auth'

/**
 * The signed-in user's own account (Phase 3). Every role can manage itself —
 * this is personal, unlike the admin-gated user management routes.
 */
export const GET = withErrorHandling('api/admin/me', async () => {
  const unauthorizedRes = await requireAdminSession()
  if (unauthorizedRes) return unauthorizedRes

  const user = await getSessionUser()
  return NextResponse.json({ user })
})

/** Change MY password: verify the current one, revoke my OTHER sessions. */
export const PUT = withErrorHandling('api/admin/me', async (request: Request) => {
  const unauthorizedRes = await requireAdminSession()
  if (unauthorizedRes) return unauthorizedRes
  assertSameOrigin(request)

  const me = await getSessionUser()
  if (!me || me.id === 'legacy-admin') {
    throw badRequest('Personal passwords need a user account — legacy sessions manage the shared credential in Settings → Security')
  }

  const parsed = changeMyPasswordSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid payload')
  }

  const row = await db.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } })
  if (!row || !scryptVerify(parsed.data.currentPassword, row.passwordHash)) {
    throw unauthorized('Current password is incorrect')
  }

  await db.user.update({
    where: { id: me.id },
    data: { passwordHash: scryptHash(parsed.data.newPassword) },
  })

  // Kill every other session for this user, then re-issue the current one so
  // the requester stays signed in.
  await revokeUserSessions(me.id)
  await createAdminSession(me.id)

  return NextResponse.json({ success: true })
})

/** Sign out everywhere: revoke all my sessions and clear this cookie. */
export const DELETE = withErrorHandling('api/admin/me', async (request: Request) => {
  const unauthorizedRes = await requireAdminSession()
  if (unauthorizedRes) return unauthorizedRes
  assertSameOrigin(request)

  const me = await getSessionUser()
  if (me && me.id !== 'legacy-admin') {
    await revokeUserSessions(me.id)
  }
  await clearAdminSession()

  return NextResponse.json({ success: true })
})
