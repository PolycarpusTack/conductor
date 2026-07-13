// G3-2 (gap 1.14): skill rows are embedded ON SAVE so the pgvector search
// path actually has rows to search. One composition + storage convention,
// shared by the create/update routes and the backfill script.

import { generateEmbedding } from '@/lib/server/embeddings'

/** What gets embedded — mirrors what the search box queries against. */
export function skillEmbeddingText(skill: {
  title: string
  description?: string | null
  body: string
}): string {
  return [skill.title, skill.description, skill.body].filter(Boolean).join('\n')
}

/**
 * Returns the STORED form (JSON float array string — pgvector accepts the
 * '[1,2,3]' text format on insert; SQLite keeps it as an opaque string), or
 * null when embeddings are unavailable (no key / API error). Embedding
 * failure must NEVER block a skill save — search degrades to text match.
 */
export async function embedSkillForStorage(skill: {
  title: string
  description?: string | null
  body: string
}): Promise<string | null> {
  const vec = await generateEmbedding(skillEmbeddingText(skill))
  return vec && vec.every(Number.isFinite) ? JSON.stringify(vec) : null
}
