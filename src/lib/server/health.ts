import { db } from '@/lib/db'
import { validateEnv } from '@/lib/env'
import { APP_VERSION } from '@/lib/version'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  env: 'ok' | 'invalid'
  /** Validation messages (variable names + constraint), never values. */
  envIssues: string[]
  version: string
  uptime: number
  timestamp: string
}

/**
 * Application health: one cheap DB query + the same env validation that runs
 * at startup. Returns structure only — no secrets, no connection strings.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    await db.project.count()
  } catch {
    dbStatus = 'error'
  }

  let envIssues: string[] = []
  try {
    validateEnv()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    envIssues = message
      .split('\n')
      .slice(1) // drop the "Invalid environment configuration:" header
      .map((line) => line.replace(/^\s*-\s*/, ''))
      .filter(Boolean)
    if (envIssues.length === 0) envIssues = ['environment validation failed']
  }

  const envStatus = envIssues.length === 0 ? 'ok' : 'invalid'

  return {
    status: dbStatus === 'ok' && envStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    env: envStatus,
    envIssues,
    version: APP_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }
}
