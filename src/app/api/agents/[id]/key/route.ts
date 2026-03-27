import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { createAgentApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    const agent = await db.agent.findUnique({
      where: { id },
      select: { apiKeyPreview: true },
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    return NextResponse.json({
      preview: agent.apiKeyPreview || null,
      revealable: false,
    })
  } catch (error) {
    console.error('Error fetching agent API key:', error)
    return NextResponse.json({ error: 'Failed to fetch agent API key' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

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
  } catch (error) {
    console.error('Error rotating agent API key:', error)
    return NextResponse.json({ error: 'Failed to rotate agent API key' }, { status: 500 })
  }
}
