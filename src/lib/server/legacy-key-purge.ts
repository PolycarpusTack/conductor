import { createHash } from 'crypto'

import { db as defaultDb } from '@/lib/db'

/**
 * Legacy plaintext API key purge (EPIC G, story G-3).
 *
 * Historically Project.apiKey / Agent.apiKey stored the raw key in plaintext.
 * B-5 moved to SHA-256 hashes (apiKeyHash). This module proactively hashes any
 * remaining plaintext key and NULLs the plaintext column so no raw secret sits
 * at rest, instead of waiting for the resolve-time auto-migrate in api-keys.ts.
 *
 * Lives in its own module (not api-keys.ts) — api-keys.ts is module-mocked by
 * several route tests, which would clobber a real import of these functions.
 * api-keys.ts re-exports them, so the public surface (`@/lib/server/api-keys`)
 * is unchanged.
 *
 * The db is INJECTABLE (defaults to the real client). Tests pass a fake db
 * directly rather than module-mocking `@/lib/db` — the shared bun mock registry
 * makes a `@/lib/db` mock non-deterministic for a widely-imported module like
 * this one, so injection is the reliable seam.
 */

export type LegacyApiKeyStatus = {
  projectsWithPlaintext: number
  agentsWithPlaintext: number
  totalWithPlaintext: number
}

type PurgeDb = Pick<typeof defaultDb, 'project' | 'agent' | '$transaction'>

// Self-contained copies of the api-keys helpers, kept private here so this
// module has no import dependency on the (module-mocked) api-keys module.
function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function previewOf(rawKey: string) {
  return `${rawKey.slice(0, 12)}...${rawKey.slice(-6)}`
}

export async function getLegacyApiKeyStatus(db: PurgeDb = defaultDb): Promise<LegacyApiKeyStatus> {
  const [projectsWithPlaintext, agentsWithPlaintext] = await Promise.all([
    db.project.count({ where: { apiKey: { not: null } } }),
    db.agent.count({ where: { apiKey: { not: null } } }),
  ])

  return {
    projectsWithPlaintext,
    agentsWithPlaintext,
    totalWithPlaintext: projectsWithPlaintext + agentsWithPlaintext,
  }
}

export async function migrateLegacyApiKeys(db: PurgeDb = defaultDb) {
  const [projects, agents] = await Promise.all([
    db.project.findMany({
      where: { apiKey: { not: null } },
      select: { id: true, apiKey: true, apiKeyPreview: true },
    }),
    db.agent.findMany({
      where: { apiKey: { not: null } },
      select: { id: true, apiKey: true, apiKeyPreview: true },
    }),
  ])

  const updates = [
    ...projects.flatMap((project) =>
      project.apiKey
        ? [
            db.project.update({
              where: { id: project.id },
              data: {
                apiKey: null,
                apiKeyHash: hashKey(project.apiKey),
                apiKeyPreview: project.apiKeyPreview || previewOf(project.apiKey),
              },
            }),
          ]
        : [],
    ),
    ...agents.flatMap((agent) =>
      agent.apiKey
        ? [
            db.agent.update({
              where: { id: agent.id },
              data: {
                apiKey: null,
                apiKeyHash: hashKey(agent.apiKey),
                apiKeyPreview: agent.apiKeyPreview || previewOf(agent.apiKey),
              },
            }),
          ]
        : [],
    ),
  ]

  if (updates.length > 0) {
    await db.$transaction(updates)
  }

  return {
    migratedProjects: projects.length,
    migratedAgents: agents.length,
    totalMigrated: projects.length + agents.length,
    status: await getLegacyApiKeyStatus(db),
  }
}
