import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { createProjectApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'

export const GET = withErrorHandling(
  'api/projects/[id]/key',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const project = await db.project.findUnique({
      where: { id },
      select: { apiKeyPreview: true },
    })

    if (!project) throw notFound('Project not found')

    return NextResponse.json({
      preview: project.apiKeyPreview || null,
      revealable: false,
    })
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/key',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const nextKey = createProjectApiKey(id)
    const project = await db.project.update({
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
      preview: project.apiKeyPreview,
    })
  },
)
