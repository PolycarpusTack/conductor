import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('admin-config')

/**
 * Instance-wide admin settings (Epic S2). The DB password hash overrides
 * the AGENTBOARD_ADMIN_PASSWORD env var, which stays the bootstrap and
 * break-glass credential (clear this row to fall back to it).
 *
 * Passwords use scrypt — a slow KDF is appropriate for low-entropy human
 * passwords, unlike the SHA-256 used for high-entropy generated keys.
 */

const SCRYPT_KEYLEN = 64

export function scryptHash(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function scryptVerify(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

export interface AdminConfig {
  passwordHash: string | null
  sessionTtlHours: number
}

const DEFAULT_CONFIG: AdminConfig = { passwordHash: null, sessionTtlHours: 12 }

// hasAdminSession runs on every admin request — cache the singleton row
// briefly so credential checks stay cheap.
const CACHE_TTL_MS = 30_000
let cached: { config: AdminConfig; at: number } | null = null

export function invalidateAdminConfigCache(): void {
  cached = null
}

export async function getAdminConfig(): Promise<AdminConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.config

  try {
    const row = await db.adminConfig.findUnique({ where: { id: 'singleton' } })
    const config: AdminConfig = row
      ? { passwordHash: row.passwordHash, sessionTtlHours: row.sessionTtlHours }
      : DEFAULT_CONFIG
    cached = { config, at: Date.now() }
    return config
  } catch (err) {
    // Credential checks must not hard-fail on a DB blip — fall back to env-only
    log.warn('failed to load admin config; using env credentials', { err: String(err) })
    return DEFAULT_CONFIG
  }
}

export async function setAdminPassword(newPassword: string): Promise<void> {
  const passwordHash = scryptHash(newPassword)
  await db.adminConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', passwordHash },
    update: { passwordHash },
  })
  invalidateAdminConfigCache()
}

export async function setSessionTtlHours(hours: number): Promise<void> {
  await db.adminConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', sessionTtlHours: hours },
    update: { sessionTtlHours: hours },
  })
  invalidateAdminConfigCache()
}
