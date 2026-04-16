import { NextResponse } from 'next/server'

import { extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { daemonHealthSchema } from '@/lib/server/daemon-contracts'

export async function POST(request: Request) {
  try {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) {
      return NextResponse.json({ error: 'Missing daemon token' }, { status: 401 })
    }

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) {
      return NextResponse.json({ error: 'Invalid daemon token' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = daemonHealthSchema.safeParse(body)

    await updateDaemonHeartbeat(daemon.id)

    return NextResponse.json({
      status: 'ok',
      daemonId: daemon.id,
      health: parsed.success ? parsed.data : null,
    })
  } catch (error) {
    console.error('Daemon heartbeat error:', error)
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 })
  }
}
