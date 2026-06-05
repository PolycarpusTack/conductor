import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { generateDaemonToken, extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { registerDaemonSchema } from '@/lib/server/daemon-contracts'
import { upsertHostForDaemon } from '@/lib/server/host-presence'

export const POST = withErrorHandling('api/daemon/register', async (request: Request) => {
  const unauth = await requireAdminSession()
  if (unauth) return unauth

  const body = await request.json()
  const parsed = registerDaemonSchema.safeParse(body)

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid registration payload')
  }

  const { hostname, platform, version, capabilities, workspaceId, host, sessionCapabilities } = parsed.data

  let resolvedWorkspaceId = workspaceId
  if (!resolvedWorkspaceId) {
    const defaultWorkspace = await db.workspace.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })

    if (!defaultWorkspace) {
      const ws = await db.workspace.create({
        data: {
          id: randomUUID(),
          slug: 'default',
          name: 'Default Workspace',
        },
      })
      resolvedWorkspaceId = ws.id
    } else {
      resolvedWorkspaceId = defaultWorkspace.id
    }
  }

  const daemonId = randomUUID()
  const token = generateDaemonToken(daemonId)

  // Durable machine identity — legacy daemons (no host block) register
  // without one and keep hostId = null until they re-register with it.
  const hostId = host
    ? await upsertHostForDaemon({
        workspaceId: resolvedWorkspaceId,
        installationId: host.installationId,
        hostname: host.hostname || hostname,
        displayName: host.displayName,
        platform,
        arch: host.arch,
        labels: host.labels,
        trustLevel: host.trustLevel,
        metadata: host.metadata,
      })
    : null

  const daemon = await db.daemon.create({
    data: {
      id: daemonId,
      workspaceId: resolvedWorkspaceId,
      hostname,
      platform,
      version,
      capabilities: JSON.stringify(capabilities),
      tokenHash: token.hash,
      tokenPreview: token.preview,
      status: 'online',
      lastSeenAt: new Date(),
      hostId,
      sessionCapabilities: sessionCapabilities ? JSON.stringify(sessionCapabilities) : null,
    },
  })

  return NextResponse.json({
    daemonId: daemon.id,
    token: token.rawToken,
    workspaceId: resolvedWorkspaceId,
    hostId,
    wsPath: '/api/daemon/ws',
  })
})

export const GET = withErrorHandling('api/daemon/register', async (request: Request) => {
  const rawToken = extractDaemonToken(request)
  if (!rawToken) throw unauthorized('Missing daemon token')

  const daemon = await resolveDaemonByToken(rawToken)
  if (!daemon) throw unauthorized('Invalid daemon token')

  await updateDaemonHeartbeat(daemon.id)

  const fullDaemon = await db.daemon.findUnique({
    where: { id: daemon.id },
    select: {
      id: true,
      hostname: true,
      platform: true,
      version: true,
      capabilities: true,
      status: true,
      lastSeenAt: true,
      workspaceId: true,
      createdAt: true,
    },
  })

  return NextResponse.json(fullDaemon)
})
