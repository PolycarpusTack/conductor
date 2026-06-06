import { mock } from 'bun:test'
import { NextResponse } from 'next/server'

export type SessionFixture = { id: string; role: string } | null

export const ADMIN_SESSION: SessionFixture = { id: 'user-1', role: 'admin' }
export const OWNER_SESSION: SessionFixture = { id: 'user-0', role: 'owner' }
export const MEMBER_SESSION: SessionFixture = { id: 'user-2', role: 'member' }

// Mutable state read at call time. Registering the mock ONCE (at helper
// import) and flipping a variable is more robust than re-registering
// mock.module per test — the route module is imported only once per file,
// and its requireAdminSession binding always reads the current fixture.
let currentSession: SessionFixture = null

// NOTE: bun's mock.module registry is shared across ALL test files in a run,
// so this factory must expose the full export surface of the real module —
// any module that imports a missing name would crash with a SyntaxError.
const ROLE_RANK: Record<string, number> = { member: 0, admin: 1, owner: 2 }

mock.module('@/lib/server/admin-session', () => ({
  isAdminAuthConfigured: () => true,
  hasAdminSession: () => Promise.resolve(currentSession !== null),
  requireAdminSession: () =>
    Promise.resolve(
      currentSession !== null
        ? null
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    ),
  requireRole: (role: string) =>
    Promise.resolve(
      currentSession === null
        ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        : (ROLE_RANK[currentSession.role] ?? 0) < (ROLE_RANK[role] ?? 0)
          ? NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
          : null,
    ),
  getSessionUser: () =>
    Promise.resolve(
      currentSession
        ? { id: currentSession.id, email: `${currentSession.id}@test.local`, name: currentSession.id, role: currentSession.role }
        : null,
    ),
  verifyAdminPassword: (password: string) => Promise.resolve(password === 'test-password'),
  createAdminSession: () => Promise.resolve(),
  clearAdminSession: () => Promise.resolve(),
}))

/**
 * Sets the session fixture for subsequent requests. Call before invoking the
 * route handler; import this helper BEFORE importing the route under test so
 * the module mock is registered first.
 */
export function setSession(fixture: SessionFixture) {
  currentSession = fixture
}

/**
 * Builds a Request with same-origin headers so the CSRF guard passes by
 * default. Override `origin` in headers to exercise the cross-origin path.
 */
export function makeRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      origin: 'http://localhost',
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}
