import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { applySessionEvent, redactSecrets } from '@/lib/server/agent-sessions'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { sessionEventSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/**
 * POST /api/daemon/sessions/[sessionId]/events — daemon streams status,
 * output, command, and metric events for a session it owns. Only a bounded,
 * redacted tail is persisted; live chunks are relayed to project subscribers.
 */
export const POST = withErrorHandling(
  'api/daemon/sessions/[sessionId]/events',
  async (request: Request, { params }: { params: Promise<{ sessionId: string }> }) => {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) throw unauthorized('Missing daemon token')

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) throw unauthorized('Invalid daemon token')

    const { sessionId } = await params
    const session = await db.agentSession.findUnique({ where: { id: sessionId } })
    if (!session) throw notFound('Session not found')
    if (session.daemonId !== daemon.id) {
      throw forbidden('Session is owned by a different daemon')
    }

    const parsed = sessionEventSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid session event')
    }
    const event = parsed.data

    const patch = applySessionEvent(session, event)
    const updated = await db.agentSession.update({ where: { id: sessionId }, data: patch })

    if (session.projectId) {
      const scope = {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        taskId: session.taskId,
        agentId: session.agentId,
        daemonId: session.daemonId,
        hostId: session.hostId,
        timestamp: new Date().toISOString(),
      }

      if (event.type === 'output') {
        broadcastProjectEvent(session.projectId, 'session-output', {
          ...scope,
          stream: event.stream,
          chunk: redactSecrets(event.chunk),
          truncated: event.truncated ?? false,
        })
      } else if (event.type === 'status') {
        broadcastProjectEvent(session.projectId, 'session-status', {
          ...scope,
          status: updated.status,
          reason: event.reason,
          exitCode: updated.exitCode,
        })
      }
    }

    return NextResponse.json({ status: 'ok', sessionStatus: updated.status })
  },
)
