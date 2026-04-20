import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'

/**
 * DELETE /api/agents/:id/memories/:memoryId
 * Agent deletes its own memory.
 */
export const DELETE = withErrorHandling(
  'api/agents/[id]/memories/[memoryId]',
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; memoryId: string }> },
  ) => {
    const apiKey = extractAgentApiKey(request)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id, memoryId } = await params
    if (agent.id !== id) throw forbidden("Cannot delete another agent's memories")

    const memory = await db.agentMemory.findUnique({ where: { id: memoryId } })
    if (!memory) throw notFound('Memory not found')
    if (memory.agentId !== agent.id) throw forbidden('Not your memory')

    await db.agentMemory.delete({ where: { id: memoryId } })
    return NextResponse.json({ success: true })
  },
)
