import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createRealtimeToken, isRealtimeConfigured } from '@/lib/server/realtime'

export const GET = withErrorHandling('api/realtime/token', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  if (!isRealtimeConfigured()) {
    return NextResponse.json({ configured: false }, { status: 503 })
  }

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) throw badRequest('Missing projectId')

  return NextResponse.json({
    configured: true,
    token: createRealtimeToken(projectId),
  })
})
