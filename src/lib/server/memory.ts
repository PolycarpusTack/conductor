import { db, isPostgresDb } from '@/lib/db'
import { generateEmbedding } from '@/lib/server/embeddings'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('memory')

// ─── Tier 1: working memory ──────────────────────────────────────────────

type WorkingMemoryOpts = {
  agentId: string
  projectId: string
  maxRecent?: number
  maxCharsPerEntry?: number
}

export async function buildWorkingMemory(opts: WorkingMemoryOpts): Promise<string> {
  const maxRecent = opts.maxRecent ?? 5
  const maxCharsPerEntry = opts.maxCharsPerEntry ?? 400

  const tasks = await db.task.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      status: 'DONE',
    },
    orderBy: { completedAt: 'desc' },
    take: maxRecent,
    select: { title: true, output: true, completedAt: true },
  })

  if (tasks.length === 0) return ''

  const entries = tasks.map((t) => {
    const output = (t.output || '').slice(0, maxCharsPerEntry).trim()
    return `- ${t.title}${output ? `\n  ${output.replace(/\n/g, '\n  ')}` : ''}`
  })

  return `Recent work you've completed on this project:\n${entries.join('\n')}`
}

// ─── Tier 2: persistent memories ─────────────────────────────────────────

export type MemoryCategory = 'fact' | 'decision' | 'preference' | 'pattern'

type SaveMemoryInput = {
  agentId: string
  projectId: string
  category: MemoryCategory
  content: string
  sourceTaskId?: string
  confidence?: number
}

export async function saveMemory(input: SaveMemoryInput) {
  const embeddingVec = await generateEmbedding(input.content)

  return db.agentMemory.create({
    data: {
      agentId: input.agentId,
      projectId: input.projectId,
      category: input.category,
      content: input.content,
      sourceTaskId: input.sourceTaskId,
      confidence: input.confidence ?? 0.8,
      embedding: embeddingVec ? JSON.stringify(embeddingVec) : null,
    },
    select: {
      id: true,
      category: true,
      content: true,
      confidence: true,
      reinforcement: true,
      sourceTaskId: true,
      lastAccessed: true,
      createdAt: true,
    },
  })
}

type SearchMemoriesOpts = {
  agentId: string
  projectId: string
  query: string
  limit?: number
}

type MemoryHit = {
  id: string
  category: string
  content: string
  confidence: number
  reinforcement: number
  score: number | null
}

export async function searchMemories(opts: SearchMemoriesOpts): Promise<MemoryHit[]> {
  const limit = opts.limit ?? 5

  if (isPostgresDb) {
    const vec = await generateEmbedding(opts.query)
    // If embedding unavailable (no key, API error), fall through to text search.
    if (vec) {
      const vectorStr = `[${vec.join(',')}]`
      const rows = await db.$queryRawUnsafe<Array<{
        id: string; category: string; content: string
        confidence: number; reinforcement: number; distance: number
      }>>(
        `SELECT id, category, content, confidence, reinforcement,
                embedding::vector <=> $1::vector AS distance
         FROM "AgentMemory"
         WHERE embedding IS NOT NULL
           AND "agentId" = $2
           AND "projectId" = $3
         ORDER BY distance ASC
         LIMIT $4`,
        vectorStr, opts.agentId, opts.projectId, limit,
      )
      return rows.map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content,
        confidence: r.confidence,
        reinforcement: r.reinforcement,
        score: 1 - r.distance,
      }))
    }
  }

  // SQLite fallback — or Postgres without an embedding for the query
  const rows = await db.agentMemory.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      content: { contains: opts.query },
    },
    orderBy: [{ reinforcement: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true, category: true, content: true,
      confidence: true, reinforcement: true,
    },
  })
  return rows.map((r) => ({ ...r, score: null }))
}

export async function reinforceMemory(id: string) {
  return db.agentMemory.update({
    where: { id },
    data: {
      reinforcement: { increment: 1 },
      lastAccessed: new Date(),
    },
  })
}

export async function buildRelevantMemory(opts: {
  agentId: string
  projectId: string
  query: string
  limit?: number
}): Promise<string> {
  const hits = await searchMemories(opts)
  if (hits.length === 0) return ''

  // Fire-and-forget reinforcement: we don't need its result, and blocking on
  // N Prisma updates would delay every dispatch. Failures are logged, not rethrown.
  void Promise.all(
    hits.map((h) =>
      reinforceMemory(h.id).catch((err) =>
        log.warn('reinforceMemory failed', { id: h.id, err: String(err) })
      )
    )
  )

  const lines = hits.map((h) => `- [${h.category}] ${h.content}`)
  return `Persistent memory (things you've learned on this project):\n${lines.join('\n')}`
}
