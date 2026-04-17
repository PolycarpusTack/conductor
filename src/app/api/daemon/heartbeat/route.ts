import { NextResponse } from 'next/server'

import { unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { daemonHealthSchema } from '@/lib/server/daemon-contracts'

export const POST = withErrorHandling('api/daemon/heartbeat', async (request: Request) => {
  const rawToken = extractDaemonToken(request)
  if (!rawToken) throw unauthorized('Missing daemon token')

  const daemon = await resolveDaemonByToken(rawToken)
  if (!daemon) throw unauthorized('Invalid daemon token')

  const body = await request.json().catch(() => ({}))
  const parsed = daemonHealthSchema.safeParse(body)

  await updateDaemonHeartbeat(daemon.id)

  return NextResponse.json({
    status: 'ok',
    daemonId: daemon.id,
    health: parsed.success ? parsed.data : null,
  })
})
