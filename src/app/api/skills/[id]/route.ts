import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateSkillSchema } from '@/lib/server/contracts'
import { embedSkillForStorage } from '@/lib/server/skill-embedding'

// G3-2-T2 (gap 1.15): the missing skill CRUD — get one, update, delete.
// `updateSkillSchema` (contracts.ts) finally has a consumer.

export const GET = withErrorHandling(
  'api/skills/[id]',
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const skill = await db.skill.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        description: true,
        body: true,
        tags: true,
        sourceTaskId: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!skill) throw notFound('Skill not found')

    return NextResponse.json({ ...skill, tags: skill.tags ? JSON.parse(skill.tags) : [] })
  },
)

export const PUT = withErrorHandling(
  'api/skills/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const parsed = updateSkillSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid skill payload')
    }

    const existing = await db.skill.findUnique({
      where: { id },
      select: { title: true, description: true, body: true },
    })
    if (!existing) throw notFound('Skill not found')

    const { title, description, body, tags } = parsed.data
    const merged = {
      title: title ?? existing.title,
      description: description !== undefined ? description : existing.description,
      body: body ?? existing.body,
    }

    // G3-2 (gap 1.14): content changed → re-embed, so semantic search never
    // ranks a skill by its previous text. Best-effort like create.
    const contentChanged =
      merged.title !== existing.title ||
      merged.description !== existing.description ||
      merged.body !== existing.body

    const skill = await db.skill.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(tags !== undefined ? { tags: tags ? JSON.stringify(tags) : null } : {}),
        ...(contentChanged ? { embedding: await embedSkillForStorage(merged) } : {}),
      },
    })

    return NextResponse.json({ ...skill, tags: skill.tags ? JSON.parse(skill.tags) : [] })
  },
)

export const DELETE = withErrorHandling(
  'api/skills/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const existing = await db.skill.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw notFound('Skill not found')

    // Agents referencing this skill keep the stale id; it silently drops out
    // of prompt injection at load time (ADR-0010 defense in depth).
    await db.skill.delete({ where: { id } })
    return NextResponse.json({ status: 'deleted', id })
  },
)
