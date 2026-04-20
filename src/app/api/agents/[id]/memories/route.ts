import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { createMemorySchema, listMemoriesSchema } from '@/lib/server/contracts'
import { saveMemory } from '@/lib/server/memory'

/**
 * Agents list their own memories. Scoped by API key — agent can only see its own.
 */
export const GET = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const apiKey = extractAgentApiKey(request)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden("Cannot read another agent's memories")

    const { searchParams } = new URL(request.url)
    const parsed = listMemoriesSchema.safeParse({
      projectId: searchParams.get('projectId') || undefined,
      category: searchParams.get('category') || undefined,
      limit: searchParams.get('limit') || undefined,
    })
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid query')
    }

    const { projectId, category, limit } = parsed.data

    const memories = await db.agentMemory.findMany({
      where: {
        agentId: agent.id,
        ...(projectId ? { projectId } : { projectId: agent.projectId }),
        ...(category ? { category } : {}),
      },
      orderBy: [{ reinforcement: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        category: true,
        content: true,
        confidence: true,
        reinforcement: true,
        sourceTaskId: true,
        lastAccessed: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ data: memories, total: memories.length })
  },
)

/**
 * Agents write a memory. Scoped to (agent, agent.projectId).
 */
export const POST = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const body = await request.json()
    const apiKey = extractAgentApiKey(request, body)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden("Cannot write another agent's memories")

    const parsed = createMemorySchema.safeParse(body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid memory payload')
    }

    if (parsed.data.sourceTaskId) {
      const task = await db.task.findUnique({
        where: { id: parsed.data.sourceTaskId },
        select: { projectId: true },
      })
      if (!task) throw notFound('sourceTaskId not found')
      if (task.projectId !== agent.projectId) {
        throw forbidden('sourceTaskId belongs to a different project')
      }
    }

    const memory = await saveMemory({
      agentId: agent.id,
      projectId: agent.projectId,
      category: parsed.data.category,
      content: parsed.data.content,
      sourceTaskId: parsed.data.sourceTaskId,
      confidence: parsed.data.confidence,
    })

    return NextResponse.json(memory)
  },
)

/**
 * DELETE /api/agents/:id/memories?memoryId=xxx
 * Agent deletes its own memory.
 */
export const DELETE = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const apiKey = extractAgentApiKey(request)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden("Cannot delete another agent's memories")

    const { searchParams } = new URL(request.url)
    const memoryId = searchParams.get('memoryId')
    if (!memoryId) throw badRequest('Missing memoryId')

    const memory = await db.agentMemory.findUnique({ where: { id: memoryId } })
    if (!memory) throw notFound('Memory not found')
    if (memory.agentId !== agent.id) throw forbidden('Not your memory')

    await db.agentMemory.delete({ where: { id: memoryId } })
    return NextResponse.json({ ok: true })
  },
)
