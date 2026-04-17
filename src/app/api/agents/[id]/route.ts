import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateAgentSchema } from '@/lib/server/contracts'
import { projectSummarySelect } from '@/lib/server/selects'

export const GET = withErrorHandling(
  'api/agents/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const agent = await db.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        emoji: true,
        color: true,
        description: true,
        isActive: true,
        lastSeen: true,
        role: true,
        capabilities: true,
        maxConcurrent: true,
        supportedModes: true,
        modeInstructions: true,
        runtimeId: true,
        runtimeModel: true,
        systemPrompt: true,
        mcpConnectionIds: true,
        invocationMode: true,
        project: {
          select: projectSummarySelect,
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
          },
        },
      },
    })

    if (!agent) throw notFound('Agent not found')

    return NextResponse.json(agent)
  },
)

export const PUT = withErrorHandling(
  'api/agents/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = updateAgentSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid agent payload')
    }

    const data: Record<string, unknown> = { ...parsed.data }
    if (data.capabilities !== undefined) {
      data.capabilities = data.capabilities ? JSON.stringify(data.capabilities) : null
    }
    if (data.supportedModes !== undefined) {
      data.supportedModes = data.supportedModes ? JSON.stringify(data.supportedModes) : null
    }
    if (data.modeInstructions !== undefined) {
      data.modeInstructions = data.modeInstructions ? JSON.stringify(data.modeInstructions) : null
    }
    if (data.mcpConnectionIds !== undefined) {
      data.mcpConnectionIds = data.mcpConnectionIds ? JSON.stringify(data.mcpConnectionIds) : null
    }

    const agent = await db.agent.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        emoji: true,
        color: true,
        description: true,
        isActive: true,
        lastSeen: true,
        role: true,
        capabilities: true,
        maxConcurrent: true,
        supportedModes: true,
        modeInstructions: true,
        runtimeId: true,
        runtimeModel: true,
        systemPrompt: true,
        mcpConnectionIds: true,
        invocationMode: true,
        project: {
          select: projectSummarySelect,
        },
      },
    })

    return NextResponse.json(agent)
  },
)

export const DELETE = withErrorHandling(
  'api/agents/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    await db.agent.delete({ where: { id } })

    return NextResponse.json({ success: true })
  },
)
