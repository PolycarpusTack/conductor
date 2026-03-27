import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { createAgentApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createAgentSchema } from '@/lib/server/contracts'
import { projectSummarySelect } from '@/lib/server/selects'

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const take = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500)
    const skip = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    const where = projectId ? { projectId } : {}

    const [agents, total] = await Promise.all([
      db.agent.findMany({
        where,
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
          runtimeId: true,
          runtimeModel: true,
          systemPrompt: true,
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
        orderBy: { createdAt: 'asc' },
        take,
        skip,
      }),
      db.agent.count({ where }),
    ])

    return NextResponse.json({ data: agents, total, limit: take, offset: skip })
  } catch (error) {
    console.error('Error fetching agents:', error)
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const parsed = createAgentSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid agent payload' },
        { status: 400 },
      )
    }

    const { name, emoji, color, description, projectId, role, capabilities,
            maxConcurrent, supportedModes, modeInstructions, runtimeId,
            runtimeModel, systemPrompt, mcpConnectionIds } = parsed.data
    const id = randomUUID()
    const provisionedKey = createAgentApiKey(id)

    const agent = await db.agent.create({
      data: {
        id,
        name,
        emoji: emoji || '🤖',
        color: color || '#3b82f6',
        description,
        projectId,
        role,
        capabilities: capabilities ? JSON.stringify(capabilities) : undefined,
        maxConcurrent: maxConcurrent || 1,
        supportedModes: supportedModes ? JSON.stringify(supportedModes) : undefined,
        modeInstructions: modeInstructions ? JSON.stringify(modeInstructions) : undefined,
        runtimeId,
        runtimeModel,
        systemPrompt,
        mcpConnectionIds: mcpConnectionIds ? JSON.stringify(mcpConnectionIds) : undefined,
        apiKeyHash: provisionedKey.hash,
        apiKeyPreview: provisionedKey.preview,
      },
      select: {
        id: true,
        name: true,
        emoji: true,
        color: true,
        description: true,
        isActive: true,
        lastSeen: true,
        project: {
          select: projectSummarySelect,
        },
      },
    })

    return NextResponse.json({ ...agent, apiKey: provisionedKey.rawKey })
  } catch (error) {
    console.error('Error creating agent:', error)
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
  }
}
