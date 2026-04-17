import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { createAgentApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'

export const GET = withErrorHandling(
  'api/agents/[id]/key',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const agent = await db.agent.findUnique({
      where: { id },
      select: { apiKeyPreview: true },
    })

    if (!agent) throw notFound('Agent not found')

    return NextResponse.json({
      preview: agent.apiKeyPreview || null,
      revealable: false,
    })
  },
)

export const POST = withErrorHandling(
  'api/agents/[id]/key',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const nextKey = createAgentApiKey(id)
    const agent = await db.agent.update({
      where: { id },
      data: {
        apiKey: null,
        apiKeyHash: nextKey.hash,
        apiKeyPreview: nextKey.preview,
      },
      select: { apiKeyPreview: true },
    })

    return NextResponse.json({
      apiKey: nextKey.rawKey,
      preview: agent.apiKeyPreview,
    })
  },
)
