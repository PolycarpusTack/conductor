import { createHash, randomBytes, timingSafeEqual } from 'crypto'

import { db } from '@/lib/db'

/**
 * Scoped API keys for external integrations (CI pipelines, scripts, webhooks).
 *
 * The raw key is returned exactly once at issue time. Storage keeps only:
 * - `prefix` — the first 8 chars in plaintext, for O(1) lookup
 * - `keyHash` — SHA-256 of the full key, compared timing-safe on validation
 *
 * Scopes are coarse capability strings (e.g. "read", "write", "mcp:execute")
 * stored as a JSON array.
 */

const PREFIX_LENGTH = 8

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export interface IssuedApiKey {
  id: string
  /** The full raw key — surfaced once, never stored. */
  rawKey: string
}

export async function issueApiKey(label: string, scopes: string[]): Promise<IssuedApiKey> {
  const rawKey = randomBytes(32).toString('hex') // 64-char hex string
  const prefix = rawKey.slice(0, PREFIX_LENGTH)
  const keyHash = hashKey(rawKey)

  const created = await db.apiKey.create({
    data: { prefix, keyHash, label, scopes: JSON.stringify(scopes) },
  })

  return { rawKey, id: created.id }
}

export interface ValidatedApiKey {
  id: string
  scopes: string[]
}

/**
 * Validates a raw key and checks it grants `requiredScope`.
 * Returns null for unknown, mismatched, revoked, or under-scoped keys.
 */
export async function validateApiKey(
  rawKey: string,
  requiredScope: string,
): Promise<ValidatedApiKey | null> {
  const prefix = rawKey.slice(0, PREFIX_LENGTH)
  const record = await db.apiKey.findUnique({ where: { prefix } })
  if (!record) return null
  if (record.revokedAt) return null

  if (!hashesMatch(record.keyHash, hashKey(rawKey))) return null

  let scopes: string[]
  try {
    scopes = JSON.parse(record.scopes)
  } catch {
    return null
  }
  if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) return null

  // Fire-and-forget lastUsedAt update — validation must not block on it
  void db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return { id: record.id, scopes }
}

export interface ApiKeySummary {
  id: string
  prefix: string
  label: string
  scopes: string[]
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** Lists all keys without hashes — safe to return to the admin UI. */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const records = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' } })
  return records.map((r) => ({
    id: r.id,
    prefix: r.prefix,
    label: r.label,
    scopes: safeParseScopes(r.scopes),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  }))
}

/** Marks a key revoked; it keeps appearing in lists for audit purposes. */
export async function revokeApiKey(id: string): Promise<boolean> {
  try {
    await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
    return true
  } catch {
    return false // unknown id
  }
}

function safeParseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
