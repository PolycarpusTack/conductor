import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { pollAndDispatch } from '@/lib/server/step-queue'

export async function POST(request: Request) {
  const expectedSecret = process.env.AGENTBOARD_WS_INTERNAL_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Internal secret not configured' }, { status: 503 })
  }

  const secret = request.headers.get('x-internal-secret')
  const providedBuffer = secret ? Buffer.from(secret) : null
  const expectedBuffer = Buffer.from(expectedSecret)
  if (
    !providedBuffer ||
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await pollAndDispatch()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Queue] Poll error:', error)
    return NextResponse.json({ error: 'Poll failed' }, { status: 500 })
  }
}
