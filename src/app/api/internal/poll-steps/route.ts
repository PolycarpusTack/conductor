import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

import { ApiError, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { pollAndDispatch } from '@/lib/server/step-queue'

export const POST = withErrorHandling('api/internal/poll-steps', async (request: Request) => {
  const expectedSecret = process.env.AGENTBOARD_WS_INTERNAL_SECRET
  if (!expectedSecret) {
    throw new ApiError(503, 'Internal secret not configured')
  }

  const secret = request.headers.get('x-internal-secret')
  const providedBuffer = secret ? Buffer.from(secret) : null
  const expectedBuffer = Buffer.from(expectedSecret)
  if (
    !providedBuffer ||
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw unauthorized()
  }

  const result = await pollAndDispatch()
  return NextResponse.json(result)
})
