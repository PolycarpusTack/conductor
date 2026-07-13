/**
 * One-shot backfill of Skill embeddings (G3-2, gap 1.14).
 *
 * Before G3-2, no skill row was ever embedded on save, so the pgvector search
 * path (`WHERE embedding IS NOT NULL`) returned 0 rows forever. New/updated
 * skills now embed on save; this script embeds the pre-existing rows.
 *
 * IDEMPOTENT: only touches rows where embedding IS NULL. Requires an
 * embedding provider (ANTHROPIC_API_KEY / EMBEDDING_MODEL per .env) — rows
 * that fail to embed are reported and left null (re-run later).
 *
 * Run with:  npx tsx scripts/backfill-skill-embeddings.ts
 * (node lane per ADR-0007 — better-sqlite3 refuses Bun)
 */

import { db } from '../src/lib/db'
import { embedSkillForStorage } from '../src/lib/server/skill-embedding'

async function main() {
  const missing = await db.skill.findMany({
    where: { embedding: null },
    select: { id: true, title: true, description: true, body: true },
  })

  if (missing.length === 0) {
    console.log('[backfill-skill-embeddings] nothing to do — every skill has an embedding.')
    return
  }

  console.log(`[backfill-skill-embeddings] ${missing.length} skill(s) without an embedding…`)
  let done = 0
  let failed = 0

  for (const skill of missing) {
    const embedding = await embedSkillForStorage(skill)
    if (!embedding) {
      failed++
      console.warn(`  ✗ ${skill.id} "${skill.title}" — embedding unavailable (provider not configured or API error)`)
      continue
    }
    await db.skill.update({ where: { id: skill.id }, data: { embedding } })
    done++
    console.log(`  ✓ ${skill.id} "${skill.title}"`)
  }

  console.log(`[backfill-skill-embeddings] done: ${done} embedded, ${failed} skipped (re-run after fixing the provider).`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('[backfill-skill-embeddings] failed:', err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
