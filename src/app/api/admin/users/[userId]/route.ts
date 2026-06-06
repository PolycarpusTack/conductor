import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { getSessionUser, requireRole } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateUserSchema } from '@/lib/server/contracts'
import { scryptHash } from '@/lib/server/admin-config'
import { invalidateUsersCache, revokeUserSessions } from '@/lib/server/user-auth'

export const PUT = withErrorHandling(
  'api/admin/users/[userId]',
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const forbidden = await requireRole('admin')
    if (forbidden) return forbidden
    assertSameOrigin(request)

    const { userId } = await params
    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    })
    if (!target) throw notFound('User not found')

    const parsed = updateUserSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid user payload')
    }

    const actor = await getSessionUser()

    // Managing an owner — or granting owner — needs an owner.
    if ((target.role === 'owner' || parsed.data.role === 'owner') && actor?.role !== 'owner') {
      throw badRequest('Only an owner can manage owner accounts')
    }

    // No self-deactivation: lockouts should be deliberate, by someone else.
    if (parsed.data.isActive === false && actor?.id === target.id) {
      throw badRequest('You cannot deactivate your own account')
    }

    // The last active owner can be neither deactivated nor demoted.
    const losesOwner =
      target.role === 'owner' &&
      (parsed.data.isActive === false || (parsed.data.role && parsed.data.role !== 'owner'))
    if (losesOwner) {
      const activeOwners = await db.user.count({ where: { role: 'owner', isActive: true } })
      if (activeOwners <= 1) {
        throw badRequest('Cannot remove the last active owner')
      }
    }

    const { resetPassword, ...fields } = parsed.data
    const tempPassword = resetPassword ? randomBytes(12).toString('base64url') : null

    const user = await db.user.update({
      where: { id: userId },
      data: {
        ...fields,
        ...(tempPassword ? { passwordHash: scryptHash(tempPassword) } : {}),
      },
      select: {
        id: true, email: true, name: true, role: true,
        isActive: true, lastLoginAt: true, createdAt: true,
      },
    })

    // Deactivation and password resets kill outstanding sessions immediately.
    if (parsed.data.isActive === false || resetPassword) {
      await revokeUserSessions(userId).catch(() => {})
    }
    invalidateUsersCache()

    return NextResponse.json(tempPassword ? { user, tempPassword } : { user })
  },
)
