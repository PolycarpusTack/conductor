import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { getAdminConfig, scryptVerify } from '@/lib/server/admin-config'
import { getLogger } from '@/lib/server/logger'

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
 * The credential fingerprint anchors session tokens (Epic S2). DB password
 * hash when set (UI-managed), else a digest of the env password (bootstrap).
 * Changing either credential changes the fingerprint, which invalidates
 * every outstanding session with zero extra bookkeeping.
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

export async function isAdminAuthConfigured(): Promise<boolean> {
  return (await getCredentialFingerprint()) !== null && Boolean(getSessionSecret())
}

export async function hasAdminSession() {
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

/**
 * Layered verification: a UI-set DB password takes precedence; the env var
 * remains the bootstrap / break-glass credential when no DB password exists.
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

export async function createAdminSession() {
  const nonce = randomBytes(16).toString('hex')
  const token = await buildSessionToken(nonce)

  if (!token) {
    throw new Error('Admin authentication is not configured on the server')
  }

  const { sessionTtlHours } = await getAdminConfig()

  const cookieStore = await cookies()
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionTtlHours * 60 * 60,
  }

  cookieStore.set(ADMIN_COOKIE_NAME, token, cookieOptions)
  cookieStore.set(ADMIN_SESSION_NONCE_COOKIE, nonce, cookieOptions)
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_COOKIE_NAME)
  cookieStore.delete(ADMIN_SESSION_NONCE_COOKIE)
}
