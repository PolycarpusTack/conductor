import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { getSessionUser, requireRole } from '@/lib/server/admin-session'
import { badRequest, conflict, withErrorHandling } from '@/lib/server/api-errors'
import { createUserSchema } from '@/lib/server/contracts'
import { createUser } from '@/lib/server/user-auth'
import {
  buildSetPasswordLink,
  isSmtpConfigured,
  issueResetToken,
  sendSetPasswordEmail,
} from '@/lib/server/password-reset'

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const

export const GET = withErrorHandling('api/admin/users', async () => {
  const forbidden = await requireRole('admin')
  if (forbidden) return forbidden

  const users = await db.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(users)
})

export const POST = withErrorHandling('api/admin/users', async (request: Request) => {
  const forbidden = await requireRole('admin')
  if (forbidden) return forbidden
  assertSameOrigin(request)

  const parsed = createUserSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid user payload')
  }

  // Only an owner can mint another owner.
  const actor = await getSessionUser()
  if (parsed.data.role === 'owner' && actor?.role !== 'owner') {
    throw badRequest('Only an owner can create owner accounts')
  }

  const existing = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })
  if (existing) throw conflict('A user with this email already exists')

  // Temporary password, shown exactly once — the API-key-rotation pattern.
  const tempPassword = randomBytes(12).toString('base64url')
  const user = await createUser({
    email: parsed.data.email,
    name: parsed.data.name,
    password: tempPassword,
    role: parsed.data.role,
  })

  // Invite by email when SMTP is configured: email a tokenized set-password
  // link instead of surfacing the temp password in-band. Unconfigured
  // instances fall back to the shown-temp-password behaviour (unchanged).
  if (isSmtpConfigured()) {
    const token = await issueResetToken(user.id)
    await sendSetPasswordEmail({
      to: user.email,
      name: user.name,
      link: buildSetPasswordLink(request, token),
      invite: true,
    })
    return NextResponse.json({ user, invited: true })
  }

  return NextResponse.json({ user, tempPassword })
})
