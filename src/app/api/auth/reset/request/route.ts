import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import {
  buildSetPasswordLink,
  isSmtpConfigured,
  issueResetToken,
  sendSetPasswordEmail,
} from '@/lib/server/password-reset'

// Public, unauthenticated. Zod schema lives here (not contracts.ts) to avoid a
// shared-file collision with D-6.
const resetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
})

/**
 * Request a password reset. To prevent account enumeration this ALWAYS returns
 * 200 with the same body — whether or not the address maps to an active user,
 * and whether or not SMTP is configured. A real, active user on an
 * SMTP-configured instance is emailed a tokenized set-password link.
 */
export const POST = withErrorHandling('api/auth/reset/request', async (request: Request) => {
  assertSameOrigin(request)

  const parsed = resetRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'A valid email is required')
  }

  if (isSmtpConfigured()) {
    const user = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, name: true, isActive: true },
    })
    if (user && user.isActive) {
      const token = await issueResetToken(user.id)
      await sendSetPasswordEmail({
        to: user.email,
        name: user.name,
        link: buildSetPasswordLink(request, token),
        invite: false,
      })
    }
  }

  // Uniform response — never reveal whether the account exists.
  return NextResponse.json({ ok: true })
})
