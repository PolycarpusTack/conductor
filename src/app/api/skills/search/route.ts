import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { skillSearchSchema } from '@/lib/server/contracts'
import { generateEmbedding } from '@/lib/server/embeddings'

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { searchParams } = new URL(request.url)
    const parsed = skillSearchSchema.safeParse({
      q: searchParams.get('q'),
      workspaceId: searchParams.get('workspaceId') || undefined,
      limit: searchParams.get('limit') || undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid search query' },
        { status: 400 },
      )
    }

    const { q, workspaceId, limit } = parsed.data

    const embedding = await generateEmbedding(q)

    if (!embedding) {
      // Fallback to text search if embedding generation fails
      const where: Record<string, unknown> = {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { body: { contains: q, mode: 'insensitive' } },
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

      return NextResponse.json({
        data: skills.map((s) => ({ ...s, tags: s.tags ? JSON.parse(s.tags) : [], score: null })),
        method: 'text',
      })
    }

    // Semantic search via pgvector cosine distance
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
  } catch (error) {
    console.error('Skill search error:', error)
    return NextResponse.json({ error: 'Failed to search skills' }, { status: 500 })
  }
}
