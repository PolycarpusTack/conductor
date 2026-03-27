import { NextResponse } from 'next/server'

import {
  clearAdminSession,
  createAdminSession,
  hasAdminSession,
  isAdminAuthConfigured,
  verifyAdminPassword,
} from '@/lib/server/admin-session'
import { adminLoginSchema } from '@/lib/server/contracts'

const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_LOGIN_ATTEMPTS = 10
// NOTE: In-memory rate limiter. Resets on server restart and does not
// persist across multiple worker processes. For production deployments
// with multiple instances, replace with Redis-backed rate limiting.
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

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.' },
        { status: 429 },
      )
    }

    if (!isAdminAuthConfigured()) {
      return NextResponse.json(
        { error: 'Admin authentication is not configured on the server' },
        { status: 503 },
      )
    }

    const parsed = adminLoginSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    const validPassword = await verifyAdminPassword(parsed.data.password)
    if (!validPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    loginAttempts.delete(ip)
    await createAdminSession()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error creating admin session:', error)
    return NextResponse.json({ error: 'Failed to sign in' }, { status: 500 })
  }
}

export async function DELETE() {
  await clearAdminSession()
  return NextResponse.json({ success: true })
}
