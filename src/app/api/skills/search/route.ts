import { NextResponse } from 'next/server'

import { db, isPostgresDb } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { skillSearchSchema } from '@/lib/server/contracts'
import { generateEmbedding } from '@/lib/server/embeddings'

async function textSearch(q: string, workspaceId: string | undefined, limit: number) {
  const where: Record<string, unknown> = {
    OR: [
      { title: { contains: q } },
      { description: { contains: q } },
      { body: { contains: q } },
      { tags: { contains: q } },
    ],
  }
  if (workspaceId) where.workspaceId = workspaceId

  const skills = await db.skill.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      tags: true,
      version: true,
      createdAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  return {
    data: skills.map((s) => ({ ...s, tags: s.tags ? JSON.parse(s.tags) : [], score: null })),
    method: 'text' as const,
  }
}

export const GET = withErrorHandling('api/skills/search', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const parsed = skillSearchSchema.safeParse({
    q: searchParams.get('q'),
    workspaceId: searchParams.get('workspaceId') || undefined,
    limit: searchParams.get('limit') || undefined,
  })

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid search query')
  }

  const { q, workspaceId, limit } = parsed.data

  // SQLite: always text search (no pgvector)
  if (!isPostgresDb) {
    return NextResponse.json(await textSearch(q, workspaceId, limit))
  }

    // Postgres: try semantic search, fall back to text
    const embedding = await generateEmbedding(q)

    if (!embedding) {
      return NextResponse.json(await textSearch(q, workspaceId, limit))
    }

    const vectorStr = `[${embedding.join(',')}]`

    const results = workspaceId
      ? await db.$queryRawUnsafe<Array<{
          id: string; title: string; description: string | null
          tags: string | null; version: number; createdAt: Date; distance: number
        }>>(
          `SELECT id, title, description, tags, version, "createdAt",
                  embedding <=> $1::vector AS distance
           FROM "Skill"
           WHERE embedding IS NOT NULL AND "workspaceId" = $2
           ORDER BY distance ASC
           LIMIT $3`,
          vectorStr, workspaceId, limit,
        )
      : await db.$queryRawUnsafe<Array<{
          id: string; title: string; description: string | null
          tags: string | null; version: number; createdAt: Date; distance: number
        }>>(
          `SELECT id, title, description, tags, version, "createdAt",
                  embedding <=> $1::vector AS distance
           FROM "Skill"
           WHERE embedding IS NOT NULL
           ORDER BY distance ASC
           LIMIT $2`,
          vectorStr, limit,
        )

    const data = results.map((r) => ({
      ...r,
      tags: r.tags ? JSON.parse(r.tags) : [],
      score: 1 - r.distance,
    }))

  return NextResponse.json({ data, method: 'semantic' })
})
