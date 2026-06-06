// Per-user accounts (Phase 1): named users with DB-backed sessions.
//
// Sessions store only a SHA-256 of the cookie token, so a DB leak doesn't
// leak live sessions, and deactivating a user (or "sign out everywhere")
// revokes access immediately — something the old stateless HMAC cookie
// fundamentally couldn't express.

import { createHash, randomBytes } from 'crypto'

import { db } from '@/lib/db'
import { getAdminConfig, scryptHash, scryptVerify } from '@/lib/server/admin-config'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('user-auth')

export const OWNER_BOOTSTRAP_EMAIL = 'owner@conductor.local'
export const USER_TOKEN_PREFIX = 'cu_'

export type UserRole = 'owner' | 'admin' | 'member'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: UserRole
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// `usersExist` runs on every authenticated request via the session shim —
// cache it briefly, invalidated on any user mutation.
let usersExistCache: { value: boolean; at: number } | null = null
const USERS_CACHE_TTL_MS = 30_000

export function invalidateUsersCache(): void {
  usersExistCache = null
}

export async function usersExist(): Promise<boolean> {
  if (usersExistCache && Date.now() - usersExistCache.at < USERS_CACHE_TTL_MS) {
    return usersExistCache.value
  }
  const count = await db.user.count()
  usersExistCache = { value: count > 0, at: Date.now() }
  return usersExistCache.value
}

export async function createUser(input: {
  email: string
  name: string
  password: string
  role?: UserRole
}): Promise<SessionUser> {
  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase().trim(),
      name: input.name,
      passwordHash: scryptHash(input.password),
      role: input.role ?? 'member',
    },
    select: { id: true, email: true, name: true, role: true },
  })
  invalidateUsersCache()
  return user as SessionUser
}

export async function verifyUserCredentials(email: string, password: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true },
  })
  if (!user || !user.isActive) return null
  if (!scryptVerify(password, user.passwordHash)) return null
  return { id: user.id, email: user.email, name: user.name, role: user.role as UserRole }
}

/** Creates a DB session and returns the raw cookie token (`cu_…`). */
export async function createUserSession(userId: string, ttlHours: number): Promise<string> {
  const token = `${USER_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`
  await db.userSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    },
  })
  return token
}

/** Resolves a raw cookie token to its user; null when expired/revoked/inactive. */
export async function resolveUserSession(token: string): Promise<SessionUser | null> {
  if (!token.startsWith(USER_TOKEN_PREFIX)) return null
  const session = await db.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  })
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null
  const { id, email, name, role } = session.user
  return { id, email, name, role: role as UserRole }
}

export async function revokeSessionByToken(token: string): Promise<void> {
  if (!token.startsWith(USER_TOKEN_PREFIX)) return
  await db.userSession.deleteMany({ where: { tokenHash: hashToken(token) } })
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await db.userSession.deleteMany({ where: { userId } })
}

/**
 * First successful legacy login after the upgrade creates the owner — with
 * the AdminConfig scrypt hash VERBATIM when one exists (same password keeps
 * working), else a fresh hash of the password that just verified.
 */
export async function bootstrapOwnerFromLegacy(password: string): Promise<SessionUser> {
  const config = await getAdminConfig()
  const user = await db.user.create({
    data: {
      email: OWNER_BOOTSTRAP_EMAIL,
      name: 'Owner',
      passwordHash: config.passwordHash ?? scryptHash(password),
      role: 'owner',
    },
    select: { id: true, email: true, name: true, role: true },
  })
  invalidateUsersCache()
  log.info('owner account bootstrapped from legacy credential', { email: user.email })
  return user as SessionUser
}
