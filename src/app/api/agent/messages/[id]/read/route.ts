import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/** POST /api/agent/messages/[id]/read — recipient marks a message read. */
export const POST = withErrorHandling(
  'api/agent/messages/[id]/read',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const rawKey = extractAgentApiKey(request)
    if (!rawKey) throw unauthorized('Missing API key')

    const agent = await resolveAgentByApiKey(rawKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    const message = await db.agentMessage.findUnique({ where: { id } })
    if (!message) throw notFound('Message not found')
    if (message.toAgentId !== agent.id) {
      throw forbidden('Message is not addressed to this agent')
    }

    if (message.status !== 'read') {
      await db.agentMessage.update({
        where: { id },
        data: { status: 'read', readAt: new Date(), deliveredAt: message.deliveredAt ?? new Date() },
      })

      broadcastProjectEvent(message.projectId, 'agent-message-read', {
        messageId: id,
        projectId: message.projectId,
        taskId: message.taskId,
        toAgentId: agent.id,
        timestamp: new Date().toISOString(),
      })
    }

    return NextResponse.json({ status: 'ok', messageId: id })
  },
)
