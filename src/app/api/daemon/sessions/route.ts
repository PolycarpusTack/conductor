import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { upsertSessionSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/**
 * POST /api/daemon/sessions — daemon upserts a session it owns, keyed by
 * (daemon.id, sessionKey). Identity (workspace, host, daemon) always derives
 * from the daemon token, never the payload.
 */
export const POST = withErrorHandling('api/daemon/sessions', async (request: Request) => {
  const rawToken = extractDaemonToken(request)
  if (!rawToken) throw unauthorized('Missing daemon token')

  const daemon = await resolveDaemonByToken(rawToken)
  if (!daemon) throw unauthorized('Invalid daemon token')

  const parsed = upsertSessionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid session payload')
  }
  const input = parsed.data

  // Task link must stay inside the daemon's workspace (same rule as
  // /api/daemon/events) — and the task is the authority for projectId.
  let projectId = input.projectId ?? null
  if (input.taskId) {
    const task = await db.task.findUnique({
      where: { id: input.taskId },
      select: { projectId: true, project: { select: { workspaceId: true } } },
    })
    if (!task) throw notFound('Task not found')
    if (task.project.workspaceId !== daemon.workspaceId) {
      throw forbidden("Task does not belong to this daemon's workspace")
    }
    projectId = task.projectId
  }

  const now = new Date()
  const shared = {
    backend: input.backend,
    cwd: input.cwd ?? null,
    command: input.command ?? null,
    agentId: input.agentId ?? null,
    projectId,
    taskId: input.taskId ?? null,
    stepId: input.stepId ?? null,
    ...(input.status ? { status: input.status } : {}),
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    lastActivityAt: now,
  }

  const session = await db.agentSession.upsert({
    where: { daemonId_sessionKey: { daemonId: daemon.id, sessionKey: input.sessionKey } },
    create: {
      daemonId: daemon.id,
      workspaceId: daemon.workspaceId,
      hostId: daemon.hostId,
      sessionKey: input.sessionKey,
      status: input.status ?? 'starting',
      ...shared,
    },
    update: shared,
  })

  if (projectId) {
    broadcastProjectEvent(projectId, 'session-status', {
      sessionId: session.id,
      workspaceId: daemon.workspaceId,
      projectId,
      taskId: session.taskId,
      agentId: session.agentId,
      daemonId: daemon.id,
      hostId: daemon.hostId,
      status: session.status,
      backend: session.backend,
      timestamp: now.toISOString(),
    })
  }

  return NextResponse.json({ sessionId: session.id })
})
