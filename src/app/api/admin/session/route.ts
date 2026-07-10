import { NextResponse } from 'next/server'

import {
  clearAdminSession,
  createAdminSession,
  getSessionUser,
  isAdminAuthConfigured,
  verifyAdminPassword,
} from '@/lib/server/admin-session'
import {
  bootstrapOwnerFromLegacy,
  usersExist,
  verifyUserCredentials,
} from '@/lib/server/user-auth'
import { db } from '@/lib/db'
import { ApiError, badRequest, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { adminLoginSchema } from '@/lib/server/contracts'
import {
  GLOBAL_MAX_ATTEMPTS,
  MAX_LOGIN_ATTEMPTS,
  clearLoginRateLimit,
  isLoginRateLimited,
} from '@/lib/server/login-rate-limit'

// Public endpoint — frontend needs to know whether to show login screen.
// Returns whether auth is configured, whether the current session is valid,
// whether user accounts exist (login form needs an email field then), and
// who is signed in.
export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json({
    configured: await isAdminAuthConfigured(),
    authenticated: user !== null,
    usersExist: await usersExist(),
    user: user ? { name: user.name, email: user.email, role: user.role } : null,
  })
}

export const POST = withErrorHandling('api/admin/session', async (request: Request) => {
  const trustProxy = process.env.TRUSTED_PROXY === 'true'
  const ip = trustProxy
    ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
       request.headers.get('x-real-ip') ||
       'unknown')
    : 'global' // single bucket when no trusted proxy — can't be bypassed by IP rotation

  // The shared 'global' bucket gets the forgiving cap (backstop only); a real
  // per-IP bucket (trusted proxy) gets the strict cap. Per-email is enforced
  // separately below and is the authoritative per-account brute-force gate.
  if (isLoginRateLimited(ip, trustProxy ? MAX_LOGIN_ATTEMPTS : GLOBAL_MAX_ATTEMPTS)) {
    throw new ApiError(429, 'Too many login attempts. Try again later.')
  }

  // Per-email bucket (Phase 3): a single account can't be brute-forced from
  // rotating IPs even behind a trusted proxy. Reuses the same window/limits.
  const bodyClone = request.clone()

  if (!(await isAdminAuthConfigured())) {
    throw new ApiError(503, 'Admin authentication is not configured on the server')
  }

  const parsed = adminLoginSchema.safeParse(await bodyClone.json())
  if (!parsed.success) throw badRequest('Password is required')

  if (parsed.data.email && isLoginRateLimited(`email:${parsed.data.email}`)) {
    throw new ApiError(429, 'Too many login attempts for this account. Try again later.')
  }

  const accountsExist = await usersExist()
  const recoveryMode = process.env.RECOVERY_MODE === '1' || process.env.RECOVERY_MODE === 'true'

  // Account login — the only path once users exist (outside recovery mode).
  if (parsed.data.email) {
    const user = await verifyUserCredentials(parsed.data.email, parsed.data.password)
    if (!user) throw unauthorized('Invalid email or password')

    clearLoginRateLimit(ip)
    clearLoginRateLimit(`email:${parsed.data.email}`)
    await createAdminSession(user.id)
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {})
    return NextResponse.json({ success: true, user: { name: user.name, email: user.email, role: user.role } })
  }

  // Legacy password-only login: allowed before the first account exists, or
  // as break-glass when RECOVERY_MODE is set.
  if (accountsExist && !recoveryMode) {
    throw unauthorized('Sign in with your account email and password')
  }

  const validPassword = await verifyAdminPassword(parsed.data.password)
  if (!validPassword) throw unauthorized('Invalid password')

  clearLoginRateLimit(ip)

  // First successful legacy login bootstraps the owner account — same
  // password, now with an identity. Recovery mode never bootstraps.
  if (!accountsExist && !recoveryMode) {
    const owner = await bootstrapOwnerFromLegacy(parsed.data.password)
    await createAdminSession(owner.id)
    return NextResponse.json({
      success: true,
      bootstrapped: owner.email,
      user: { name: owner.name, email: owner.email, role: owner.role },
    })
  }

  await createAdminSession()
  return NextResponse.json({ success: true })
})

export const DELETE = withErrorHandling('api/admin/session', async () => {
  await clearAdminSession()
  return NextResponse.json({ success: true })
})
