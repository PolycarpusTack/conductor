import { NextResponse } from 'next/server'
import { z } from 'zod'

import { assertSameOrigin } from '@/lib/csrf'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { getLogger } from '@/lib/server/logger'
import { ResetTokenError, consumeResetToken } from '@/lib/server/password-reset'

const log = getLogger('api/auth/reset')

// Zod schema lives here (not contracts.ts) to avoid a shared-file collision
// with D-6. Password rules mirror changeMyPasswordSchema (min 8).
const resetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
})

/**
 * Confirm a password reset: consume the token, set the new password. A bad /
 * expired / used token yields a generic 400 — the specific reason is never
 * leaked to the client.
 */
export const POST = withErrorHandling('api/auth/reset/confirm', async (request: Request) => {
  assertSameOrigin(request)

  const parsed = resetConfirmSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid payload')
  }

  try {
    const { userId } = await consumeResetToken(parsed.data.token, parsed.data.password)
    log.info('set-password', { userId })
  } catch (err) {
    if (err instanceof ResetTokenError) {
      throw badRequest('This reset link is invalid or has expired. Request a new one.')
    }
    throw err
  }

  return NextResponse.json({ ok: true })
})
