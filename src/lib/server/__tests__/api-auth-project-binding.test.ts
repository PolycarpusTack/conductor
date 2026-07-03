import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// B-4: project-scoped API keys — a scoped key bound to project P must not
// authorize work targeting project Q. Legacy keys (projectId null) keep
// instance-wide behaviour but emit a deprecation warning.
//
// Registers the shared admin-session mock (helpers/auth) BEFORE importing
// api-auth so the module graph resolves without a real session layer.
// ---------------------------------------------------------------------------

import { setSession } from '../../../__tests__/helpers/auth'

const RAW_BOUND_KEY = '1'.repeat(64)
const RAW_LEGACY_KEY = '2'.repeat(64)

function sha256(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

const BOUND_KEY_RECORD = {
  id: 'key-bound',
  prefix: RAW_BOUND_KEY.slice(0, 8),
  keyHash: sha256(RAW_BOUND_KEY),
  label: 'bound',
  scopes: '["read","write"]',
  projectId: 'proj-p',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

const LEGACY_KEY_RECORD = {
  id: 'key-legacy',
  prefix: RAW_LEGACY_KEY.slice(0, 8),
  keyHash: sha256(RAW_LEGACY_KEY),
  label: 'legacy',
  scopes: '["read","write"]',
  projectId: null,
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

const mockActivityLogCreate = mock(() => Promise.resolve({})) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) => {
        if (where.prefix === BOUND_KEY_RECORD.prefix) return Promise.resolve(BOUND_KEY_RECORD)
        if (where.prefix === LEGACY_KEY_RECORD.prefix) return Promise.resolve(LEGACY_KEY_RECORD)
        return Promise.resolve(null)
      },
      update: () => Promise.resolve({}),
    },
    activityLog: { create: mockActivityLogCreate },
  },
  isPostgresDb: false,
}))

// Import AFTER mocks are registered
import { authorizeAdminOrScopedKey, assertKeyProjectAccess } from '../api-auth'
import { ApiError } from '../api-errors'

beforeEach(() => {
  setSession(null)
  mockActivityLogCreate.mockReset()
  mockActivityLogCreate.mockResolvedValue({})
})

function bearerRequest(rawKey: string): Request {
  return new Request('http://localhost/api/anything', {
    headers: { authorization: `Bearer ${rawKey}` },
  })
}

describe('authorizeAdminOrScopedKey — project binding surfaced', () => {
  test('a bound key reports its projectId in the outcome', async () => {
    const outcome = await authorizeAdminOrScopedKey(bearerRequest(RAW_BOUND_KEY), 'write')
    expect(outcome).toEqual({ ok: true, via: 'key', keyId: 'key-bound', projectId: 'proj-p' })
  })

  test('a legacy key reports projectId null', async () => {
    const outcome = await authorizeAdminOrScopedKey(bearerRequest(RAW_LEGACY_KEY), 'write')
    expect(outcome).toEqual({ ok: true, via: 'key', keyId: 'key-legacy', projectId: null })
  })
})

describe('assertKeyProjectAccess', () => {
  test('allows a key bound to the target project', () => {
    expect(() =>
      assertKeyProjectAccess({ ok: true, via: 'key', keyId: 'key-bound', projectId: 'proj-p' }, 'proj-p'),
    ).not.toThrow()
    expect(mockActivityLogCreate).not.toHaveBeenCalled()
  })

  test('rejects a key bound to a different project with 403', () => {
    let thrown: unknown
    try {
      assertKeyProjectAccess({ ok: true, via: 'key', keyId: 'key-bound', projectId: 'proj-p' }, 'proj-q')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect((thrown as ApiError).status).toBe(403)
  })

  test('legacy unbound key passes but emits a deprecation warning activity', () => {
    expect(() =>
      assertKeyProjectAccess({ ok: true, via: 'key', keyId: 'key-legacy', projectId: null }, 'proj-q'),
    ).not.toThrow()

    expect(mockActivityLogCreate).toHaveBeenCalledTimes(1)
    const { data } = mockActivityLogCreate.mock.calls[0][0]
    expect(data.action).toBe('scoped_key_unbound_deprecated')
    expect(data.level).toBe('warn')
    expect(data.projectId).toBe('proj-q')
    expect(data.details).toContain('key-legacy')
  })

  test('session auth is never project-restricted and never warns', () => {
    expect(() => assertKeyProjectAccess({ ok: true, via: 'session' }, 'proj-q')).not.toThrow()
    expect(mockActivityLogCreate).not.toHaveBeenCalled()
  })
})
