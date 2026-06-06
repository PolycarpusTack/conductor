import { PrismaClient } from '@/generated/prisma/client'
import { getAttributionUserId } from '@/lib/server/request-context'

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined
}

/** True when connected to PostgreSQL (enables pgvector features). */
export const isPostgresDb = (process.env.DATABASE_URL || '').startsWith('postgresql')

function createBaseClient() {
  // Adapter is resolved synchronously at startup.
  // Both adapter packages are installed; only one is loaded per environment.
  if (isPostgresDb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@prisma/adapter-pg')
    const adapter = new mod.PrismaPg({ connectionString: process.env.DATABASE_URL! })
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@prisma/adapter-better-sqlite3')
  const adapter = new mod.PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
  })
}

function createClient() {
  // Attribution (Phase 2): every activity row written while a signed-in user's
  // request is in flight gets stamped with that user — no call-site changes.
  // Agent/daemon/scheduler writes have no request user and stay unattributed.
  return createBaseClient().$extends({
    query: {
      activityLog: {
        create({ args, query }) {
          if (args.data && !('userId' in args.data && args.data.userId)) {
            const userId = getAttributionUserId()
            if (userId) args.data.userId = userId
          }
          return query(args)
        },
      },
    },
  })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
