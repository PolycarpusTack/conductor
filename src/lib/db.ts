import { PrismaClient } from '@/generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** True when connected to PostgreSQL (enables pgvector features). */
export const isPostgresDb = (process.env.DATABASE_URL || '').startsWith('postgresql')

function createClient() {
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

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
