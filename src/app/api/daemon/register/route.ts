import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { generateDaemonToken, extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { registerDaemonSchema } from '@/lib/server/daemon-contracts'

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const body = await request.json()
    const parsed = registerDaemonSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid registration payload' },
        { status: 400 },
      )
    }

    const { hostname, platform, version, capabilities, workspaceId } = parsed.data

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
      },
    })

    return NextResponse.json({
      daemonId: daemon.id,
      token: token.rawToken,
      workspaceId: resolvedWorkspaceId,
      wsPath: '/api/daemon/ws',
    })
  } catch (error) {
    console.error('Daemon registration error:', error)
    return NextResponse.json(
      { error: 'Failed to register daemon' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  try {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) {
      return NextResponse.json(
        { error: 'Missing daemon token', hint: 'Use Authorization: Bearer <token>' },
        { status: 401 },
      )
    }

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) {
      return NextResponse.json({ error: 'Invalid daemon token' }, { status: 401 })
    }

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
  } catch (error) {
    console.error('Daemon status error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch daemon status' },
      { status: 500 },
    )
  }
}
