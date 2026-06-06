import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { getAdminConfig, scryptVerify } from '@/lib/server/admin-config'
import { getLogger } from '@/lib/server/logger'
import {
  resolveUserSession,
  revokeSessionByToken,
  createUserSession,
  usersExist,
  USER_TOKEN_PREFIX,
  type SessionUser,
  type UserRole,
} from '@/lib/server/user-auth'

const log = getLogger('admin-session')

const ADMIN_COOKIE_NAME = 'agentboard_admin_session'
const ADMIN_SESSION_NONCE_COOKIE = 'agentboard_admin_nonce'

function getEnvPassword() {
  return process.env.AGENTBOARD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || null
}

if (!getEnvPassword()) {
  log.warn('No admin password configured. Set AGENTBOARD_ADMIN_PASSWORD in .env to enable admin access.')
}

function getSessionSecret() {
  return process.env.AGENTBOARD_ADMIN_SESSION_SECRET || getEnvPassword()
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function secureEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * The credential fingerprint anchors LEGACY session tokens (Epic S2). DB
 * password hash when set (UI-managed), else a digest of the env password.
 * Once user accounts exist, sessions move to DB-backed tokens (user-auth.ts)
 * and the legacy path only stays open for RECOVERY_MODE.
 */
async function getCredentialFingerprint(): Promise<string | null> {
  const config = await getAdminConfig()
  if (config.passwordHash) return config.passwordHash

  const envPassword = getEnvPassword()
  return envPassword ? digest(envPassword) : null
}

async function buildSessionToken(nonce: string): Promise<string | null> {
  const fingerprint = await getCredentialFingerprint()
  const secret = getSessionSecret()

  if (!fingerprint || !secret) {
    return null
  }

  return digest(`${fingerprint}:${secret}:${nonce}`)
}

/** Break-glass: keeps the legacy password path open even when users exist. */
function isRecoveryMode(): boolean {
  return process.env.RECOVERY_MODE === '1' || process.env.RECOVERY_MODE === 'true'
}

export async function isAdminAuthConfigured(): Promise<boolean> {
  if (await usersExist()) return true
  return (await getCredentialFingerprint()) !== null && Boolean(getSessionSecret())
}

/** Legacy HMAC pair is only honored before the first user exists (or in recovery). */
async function hasLegacySession(): Promise<boolean> {
  if ((await usersExist()) && !isRecoveryMode()) return false

  const cookieStore = await cookies()
  const nonce = cookieStore.get(ADMIN_SESSION_NONCE_COOKIE)?.value
  const sessionToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value

  if (!nonce || !sessionToken) {
    return false
  }

  const expectedToken = await buildSessionToken(nonce)
  if (!expectedToken) {
    return false
  }

  return secureEquals(sessionToken, expectedToken)
}

/**
 * The session user, or null. A valid legacy session acts as a synthetic
 * owner so pre-account deployments (and recovery mode) lose nothing.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (!token) return null

  if (token.startsWith(USER_TOKEN_PREFIX)) {
    return resolveUserSession(token)
  }

  if (await hasLegacySession()) {
    return { id: 'legacy-admin', email: 'admin@legacy', name: 'Admin (legacy)', role: 'owner' }
  }
  return null
}

export async function hasAdminSession() {
  return (await getSessionUser()) !== null
}

export async function requireAdminSession() {
  if (!(await isAdminAuthConfigured())) {
    return NextResponse.json(
      { error: 'Admin authentication is not configured on the server' },
      { status: 503 },
    )
  }

  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

const ROLE_RANK: Record<UserRole, number> = { member: 0, admin: 1, owner: 2 }

/**
 * Role gate for the privileged surface (security config, user management,
 * project delete). 401 without a session, 403 below the required role.
 */
export async function requireRole(role: 'admin' | 'owner') {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const user = await getSessionUser()
  if (!user || ROLE_RANK[user.role] < ROLE_RANK[role]) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return null
}

/**
 * Layered verification of the LEGACY credential: a UI-set DB password takes
 * precedence; the env var remains the bootstrap / break-glass credential.
 */
export async function verifyAdminPassword(password: string) {
  const config = await getAdminConfig()
  if (config.passwordHash) {
    return scryptVerify(password, config.passwordHash)
  }

  const envPassword = getEnvPassword()
  if (!envPassword) {
    return false
  }

  return secureEquals(password, envPassword)
}

/**
 * Starts a session. With a userId: DB-backed token (per-user revocation).
 * Without: the legacy HMAC pair — only used before the first user exists.
 */
export async function createAdminSession(userId?: string) {
  const { sessionTtlHours } = await getAdminConfig()

  const cookieStore = await cookies()
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionTtlHours * 60 * 60,
  }

  if (userId) {
    const token = await createUserSession(userId, sessionTtlHours)
    cookieStore.set(ADMIN_COOKIE_NAME, token, cookieOptions)
    cookieStore.delete(ADMIN_SESSION_NONCE_COOKIE)
    return
  }

  const nonce = randomBytes(16).toString('hex')
  const token = await buildSessionToken(nonce)

  if (!token) {
    throw new Error('Admin authentication is not configured on the server')
  }

  cookieStore.set(ADMIN_COOKIE_NAME, token, cookieOptions)
  cookieStore.set(ADMIN_SESSION_NONCE_COOKIE, nonce, cookieOptions)
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  if (token?.startsWith(USER_TOKEN_PREFIX)) {
    await revokeSessionByToken(token).catch(() => {})
  }
  cookieStore.delete(ADMIN_COOKIE_NAME)
  cookieStore.delete(ADMIN_SESSION_NONCE_COOKIE)
}
