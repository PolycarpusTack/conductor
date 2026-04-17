import { NextResponse } from 'next/server'

import {
  clearAdminSession,
  createAdminSession,
  hasAdminSession,
  isAdminAuthConfigured,
  verifyAdminPassword,
} from '@/lib/server/admin-session'
import { ApiError, badRequest, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { adminLoginSchema } from '@/lib/server/contracts'

const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_LOGIN_ATTEMPTS = 10
// NOTE: In-memory rate limiter. Resets on server restart and does not
// persist across multiple worker processes. For production deployments
// with multiple instances, replace with Redis-backed rate limiting.
// NOTE: When no trusted proxy is configured (TRUSTED_PROXY env var not set),
// all requests share a single rate-limit bucket ('global'). This prevents
// bypass via X-Forwarded-For / X-Real-IP header rotation. If TRUSTED_PROXY=true,
// the operator MUST configure their reverse proxy to strip and rewrite these
// headers so clients cannot spoof them.
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
    return false
  }

  entry.count++
  return entry.count > MAX_LOGIN_ATTEMPTS
}

// Public endpoint — frontend needs to know whether to show login screen.
// Returns whether auth is configured and whether the current session is valid.
export async function GET() {
  return NextResponse.json({
    configured: isAdminAuthConfigured(),
    authenticated: await hasAdminSession(),
  })
}

export const POST = withErrorHandling('api/admin/session', async (request: Request) => {
  const trustProxy = process.env.TRUSTED_PROXY === 'true'
  const ip = trustProxy
    ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
       request.headers.get('x-real-ip') ||
       'unknown')
    : 'global' // single bucket when no trusted proxy — can't be bypassed by IP rotation

  if (isRateLimited(ip)) {
    throw new ApiError(429, 'Too many login attempts. Try again later.')
  }

  if (!isAdminAuthConfigured()) {
    throw new ApiError(503, 'Admin authentication is not configured on the server')
  }

  const parsed = adminLoginSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest('Password is required')

  const validPassword = await verifyAdminPassword(parsed.data.password)
  if (!validPassword) throw unauthorized('Invalid password')

  loginAttempts.delete(ip)
  await createAdminSession()
  return NextResponse.json({ success: true })
})

export const DELETE = withErrorHandling('api/admin/session', async () => {
  await clearAdminSession()
  return NextResponse.json({ success: true })
})
