import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(import.meta.dir, '..', 'prisma', 'dev.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS "Trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "eventType" TEXT,
    "eventFilters" TEXT NOT NULL DEFAULT '[]',
    "pollConfig" TEXT NOT NULL DEFAULT '{}',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "lastFiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trigger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE INDEX IF NOT EXISTS "Trigger_projectId_idx" ON "Trigger"("projectId");
  CREATE INDEX IF NOT EXISTS "Trigger_projectId_type_idx" ON "Trigger"("projectId", "type");
  CREATE INDEX IF NOT EXISTS "Trigger_projectId_eventType_idx" ON "Trigger"("projectId", "eventType");

  CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "triggerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastFiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reaction_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE INDEX IF NOT EXISTS "Reaction_triggerId_order_idx" ON "Reaction"("triggerId", "order");
`)

console.log('Migration complete: Trigger and Reaction tables created.')
db.close()
