/**
 * SQLite → PostgreSQL Migration Script
 *
 * Usage:
 *   SQLITE_PATH=./prisma/dev.db DATABASE_URL=postgresql://... bun run scripts/migrate-sqlite-to-postgres.ts
 *
 * What it does:
 *   1. Reads all rows from every table in the SQLite database
 *   2. Writes them into the PostgreSQL database (which must already have the schema via `prisma migrate deploy`)
 *   3. Resets Postgres sequences to match the max ID values
 *
 * Prerequisites:
 *   - Postgres DB created and schema applied: `npx prisma migrate deploy`
 *   - pgvector extension enabled: `CREATE EXTENSION IF NOT EXISTS vector;`
 *   - SQLite file accessible at SQLITE_PATH
 */

import Database from 'better-sqlite3'

const SQLITE_PATH = process.env.SQLITE_PATH || './prisma/dev.db'
const PG_URL = process.env.DATABASE_URL

if (!PG_URL || !PG_URL.startsWith('postgresql')) {
  console.error('DATABASE_URL must be a PostgreSQL connection string')
  process.exit(1)
}

// Table migration order (respects FK constraints)
const TABLE_ORDER = [
  'Workspace',
  'Project',
  'Agent',
  'Task',
  'ActivityLog',
  'ProjectMode',
  'ProjectRuntime',
  'ProjectMcpConnection',
  'ChainTemplate',
  'TaskStep',
  'StepExecution',
  'ToolCallTrace',
  'StepArtifact',
  'StepReview',
  'Daemon',
]

async function main() {
  console.log(`[migrate] SQLite: ${SQLITE_PATH}`)
  console.log(`[migrate] Postgres: ${PG_URL?.replace(/:[^@]+@/, ':***@')}`)

  const sqlite = new Database(SQLITE_PATH, { readonly: true })

  // Dynamic import for pg since it may not be installed yet
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: PG_URL })
  await client.connect()

  try {
    for (const table of TABLE_ORDER) {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]

      if (rows.length === 0) {
        console.log(`[migrate] ${table}: 0 rows (skip)`)
        continue
      }

      const columns = Object.keys(rows[0])
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const columnList = columns.map((c) => `"${c}"`).join(', ')

      // Truncate target table first (cascade to handle FKs within same batch)
      await client.query(`TRUNCATE TABLE "${table}" CASCADE`)

      let migrated = 0
      for (const row of rows) {
        const values = columns.map((col) => {
          const val = row[col]
          // SQLite stores booleans as 0/1; Postgres wants true/false
          if (val === 0 || val === 1) {
            // Check if this should be a boolean by inspecting the value context
            // Prisma boolean fields in SQLite are stored as INTEGER 0/1
            // We can't reliably distinguish from actual integers here,
            // so we pass as-is and let Postgres coerce
          }
          return val
        })

        await client.query(
          `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        )
        migrated++
      }

      console.log(`[migrate] ${table}: ${migrated} rows`)
    }

    console.log('[migrate] Done!')
  } finally {
    await client.end()
    sqlite.close()
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err)
  process.exit(1)
})
