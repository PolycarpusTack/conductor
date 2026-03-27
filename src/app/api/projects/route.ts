import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createProjectApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createProjectSchema } from '@/lib/server/contracts'
import { seedChainTemplates } from '@/lib/server/chain-templates'
import { seedProjectModes } from '@/lib/server/default-modes'

export async function GET() {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const projects = await db.project.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            agents: true,
            tasks: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(projects)
  } catch (error) {
    console.error('Error fetching projects:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const parsed = createProjectSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid project payload' }, { status: 400 })
    }

    const { name, description, color } = parsed.data
    const id = randomUUID()
    const provisionedKey = createProjectApiKey(id)

    const project = await db.project.create({
      data: {
        id,
        name,
        description,
        color: color || '#3b82f6',
        apiKeyHash: provisionedKey.hash,
        apiKeyPreview: provisionedKey.preview,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
      },
    })

    await seedProjectModes(project.id)
    await seedChainTemplates(project.id)

    return NextResponse.json({ ...project, apiKey: provisionedKey.rawKey })
  } catch (error) {
    console.error('Error creating project:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
