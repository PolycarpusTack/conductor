import { mock } from 'bun:test'
import { NextResponse } from 'next/server'

export type SessionFixture = { id: string; role: string } | null

export const ADMIN_SESSION: SessionFixture = { id: 'user-1', role: 'admin' }

// Mutable state read at call time. Registering the mock ONCE (at helper
// import) and flipping a variable is more robust than re-registering
// mock.module per test — the route module is imported only once per file,
// and its requireAdminSession binding always reads the current fixture.
let currentSession: SessionFixture = null

// NOTE: bun's mock.module registry is shared across ALL test files in a run,
// so this factory must expose the full export surface of the real module —
// any module that imports a missing name would crash with a SyntaxError.
mock.module('@/lib/server/admin-session', () => ({
  isAdminAuthConfigured: () => true,
  hasAdminSession: () => Promise.resolve(currentSession !== null),
  requireAdminSession: () =>
    Promise.resolve(
      currentSession !== null
        ? null
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
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
