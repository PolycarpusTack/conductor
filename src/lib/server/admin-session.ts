import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const ADMIN_COOKIE_NAME = 'agentboard_admin_session'
const ADMIN_SESSION_NONCE_COOKIE = 'agentboard_admin_nonce'
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12

function getAdminPassword() {
  return process.env.AGENTBOARD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || null
}

if (!getAdminPassword()) {
  console.warn('[Conductor] WARNING: No admin password configured. Set AGENTBOARD_ADMIN_PASSWORD in .env to enable admin access.')
}

function getSessionSecret() {
  return process.env.AGENTBOARD_ADMIN_SESSION_SECRET || getAdminPassword()
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

function buildSessionToken(nonce: string) {
  const password = getAdminPassword()
  const secret = getSessionSecret()

  if (!password || !secret) {
    return null
  }

  return digest(`${password}:${secret}:${nonce}`)
}

export function isAdminAuthConfigured() {
  const password = getAdminPassword()
  const secret = getSessionSecret()
  return Boolean(password && secret)
}

export async function hasAdminSession() {
  const cookieStore = await cookies()
  const nonce = cookieStore.get(ADMIN_SESSION_NONCE_COOKIE)?.value
  const sessionToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value

  if (!nonce || !sessionToken) {
    return false
  }

  const expectedToken = buildSessionToken(nonce)
  if (!expectedToken) {
    return false
  }

  return secureEquals(sessionToken, expectedToken)
}

export async function requireAdminSession() {
  if (!isAdminAuthConfigured()) {
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

export async function verifyAdminPassword(password: string) {
  const configuredPassword = getAdminPassword()

  if (!configuredPassword) {
    return false
  }

  return secureEquals(password, configuredPassword)
}

export async function createAdminSession() {
  const nonce = randomBytes(16).toString('hex')
  const token = buildSessionToken(nonce)

  if (!token) {
    throw new Error('Admin authentication is not configured on the server')
  }

  const cookieStore = await cookies()
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  }

  cookieStore.set(ADMIN_COOKIE_NAME, token, cookieOptions)
  cookieStore.set(ADMIN_SESSION_NONCE_COOKIE, nonce, cookieOptions)
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_COOKIE_NAME)
  cookieStore.delete(ADMIN_SESSION_NONCE_COOKIE)
}
