import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { createProjectApiKey } from '@/lib/server/api-keys'
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
    const project = await db.project.findUnique({
      where: { id },
      select: { apiKeyPreview: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      preview: project.apiKeyPreview || null,
      revealable: false,
    })
  } catch (error) {
    console.error('Error fetching project API key:', error)
    return NextResponse.json({ error: 'Failed to fetch project API key' }, { status: 500 })
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
  } catch (error) {
    console.error('Error rotating project API key:', error)
    return NextResponse.json({ error: 'Failed to rotate project API key' }, { status: 500 })
  }
}
