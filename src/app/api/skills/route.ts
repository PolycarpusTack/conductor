import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createSkillSchema } from '@/lib/server/contracts'
import { requireWorkspaceId } from '@/lib/server/workspace'

export const GET = withErrorHandling('api/skills', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  let workspaceId = searchParams.get('workspaceId') || undefined
  const projectId = searchParams.get('projectId') || undefined
  const tag = searchParams.get('tag') || undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100)

  // G3-1 (ADR-0010): the agent editor asks by projectId — resolve the
  // project's workspace server-side (skills are workspace-scoped; attaching
  // across the boundary is rejected at agent write time). A workspace-less
  // project has no attachable skills: empty list + workspaceId: null so the
  // UI can explain why instead of showing a bare empty state.
  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    })
    if (!project?.workspaceId) {
      return NextResponse.json({ data: [], total: 0, workspaceId: null })
    }
    workspaceId = project.workspaceId
  }

  const where: Record<string, unknown> = {}
  if (workspaceId) where.workspaceId = workspaceId
  if (tag) where.tags = { contains: tag }

  const skills = await db.skill.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      tags: true,
      sourceTaskId: true,
      version: true,
      workspaceId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  const parsed = skills.map((s) => ({
    ...s,
    tags: s.tags ? JSON.parse(s.tags) : [],
  }))

  return NextResponse.json({ data: parsed, total: parsed.length, workspaceId: workspaceId ?? null })
})

export const POST = withErrorHandling('api/skills', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const parsed = createSkillSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid skill payload')
  }

  const { title, description, body, tags, sourceTaskId, workspaceId: reqWsId } = parsed.data
  const workspaceId = await requireWorkspaceId(reqWsId)

  const skill = await db.skill.create({
    data: {
      id: randomUUID(),
      workspaceId,
      title,
      description,
      body,
      tags: tags ? JSON.stringify(tags) : null,
      sourceTaskId,
      version: 1,
    },
  })

  return NextResponse.json(skill)
})
