/**
 * One-shot purge of legacy PLAINTEXT API keys (EPIC G, story G-3).
 *
 * Historically Project.apiKey and Agent.apiKey stored the raw key in plaintext.
 * B-5 moved to SHA-256 hashes (apiKeyHash) with an auto-migrate-on-use fallback
 * (src/lib/server/api-keys.ts → resolveAgentByApiKey). That fallback only fires
 * when a legacy key is *presented*, so a key that is never used again lingers in
 * plaintext indefinitely. This script proactively hashes every remaining
 * plaintext key and NULLs the plaintext column, so no raw secret sits at rest.
 *
 * It is IDEMPOTENT: it only touches rows where apiKey IS NOT NULL. Already-hashed
 * keys (apiKey === null, apiKeyHash set) are untouched. Re-running is a no-op.
 *
 * It does NOT drop the plaintext columns — that is a schema migration and a
 * separate follow-up (Project.apiKey / Agent.apiKey column drop). After this
 * script reports 0 remaining plaintext keys across a fleet, the resolve-time
 * fallback in api-keys.ts can be removed and the columns dropped.
 *
 *   bun run scripts/purge-legacy-keys.ts            purge, print a summary
 *   bun run scripts/purge-legacy-keys.ts --check    report only, change nothing
 */
import { db } from '../src/lib/db'
import { getLegacyApiKeyStatus, migrateLegacyApiKeys } from '../src/lib/server/legacy-key-purge'

async function main() {
  const checkOnly = process.argv.slice(2).includes('--check')

  const before = await getLegacyApiKeyStatus()
  if (before.totalWithPlaintext === 0) {
    console.log('No legacy plaintext keys remain — nothing to purge.')
    return
  }

  console.log(
    `Found ${before.totalWithPlaintext} plaintext key(s): ` +
      `${before.projectsWithPlaintext} project(s), ${before.agentsWithPlaintext} agent(s).`,
  )

  if (checkOnly) {
    console.log('--check: no changes made. Run without --check to hash + NULL them.')
    process.exitCode = 1 // non-zero so CI/doctor can gate on "plaintext keys still present"
    return
  }

  const result = await migrateLegacyApiKeys()
  console.log(
    `Purged: hashed + NULLed ${result.totalMigrated} key(s) ` +
      `(${result.migratedProjects} project, ${result.migratedAgents} agent). ` +
      `Remaining plaintext: ${result.status.totalWithPlaintext}.`,
  )
}

main()
  .catch((err) => {
    console.error('purge-legacy-keys failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
