import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { createAgentApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'

/**
 * POST /api/agents/[id]/duplicate — clone an agent's configuration (Epic S2).
 * The copy gets a fresh API key (returned once) and starts inactive so it
 * never claims work before someone reviews it.
 */
export const POST = withErrorHandling(
  'api/agents/[id]/duplicate',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const source = await db.agent.findUnique({ where: { id } })
    if (!source) throw notFound('Agent not found')

    const newId = randomUUID()
    const key = createAgentApiKey(newId)

    const copy = await db.agent.create({
      data: {
        id: newId,
        projectId: source.projectId,
        name: `${source.name} (copy)`,
        emoji: source.emoji,
        color: source.color,
        description: source.description,
        role: source.role,
        personality: source.personality,
        capabilities: source.capabilities,
        maxConcurrent: source.maxConcurrent,
        supportedModes: source.supportedModes,
        modeInstructions: source.modeInstructions,
        invocationMode: source.invocationMode,
        runtimeId: source.runtimeId,
        runtimeModel: source.runtimeModel,
        systemPrompt: source.systemPrompt,
        mcpConnectionIds: source.mcpConnectionIds,
        isActive: false, // review before it claims work
        apiKeyHash: key.hash,
        apiKeyPreview: key.preview,
      },
    })

    return NextResponse.json({ agent: copy, rawKey: key.rawKey }, { status: 201 })
  },
)
