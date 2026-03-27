import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { createRealtimeToken, isRealtimeConfigured } from '@/lib/server/realtime'

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    if (!isRealtimeConfigured()) {
      return NextResponse.json({ configured: false }, { status: 503 })
    }

    const projectId = new URL(request.url).searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    return NextResponse.json({
      configured: true,
      token: createRealtimeToken(projectId),
    })
  } catch (error) {
    console.error('Error creating realtime token:', error)
    return NextResponse.json({ error: 'Failed to create realtime token' }, { status: 500 })
  }
}
