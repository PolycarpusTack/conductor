import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing the module under test
// ---------------------------------------------------------------------------

const mockCreate = mock(() => Promise.resolve({ id: 'key-1' })) as any
const mockFindUnique = mock(() => Promise.resolve(null)) as any
const mockFindMany = mock(() => Promise.resolve([])) as any
const mockUpdate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    apiKey: {
      create: mockCreate,
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      update: mockUpdate,
    },
  },
}))

// Import AFTER mocking
import { issueApiKey, validateApiKey, listApiKeys, revokeApiKey } from '../scoped-api-keys'

function sha256(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

function makeRecord(rawKey: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    prefix: rawKey.slice(0, 8),
    keyHash: sha256(rawKey),
    label: 'CI',
    scopes: '["read"]',
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreate.mockImplementation(() => Promise.resolve({ id: 'key-1' }))
  mockFindUnique.mockReset()
  mockFindUnique.mockImplementation(() => Promise.resolve(null))
  mockFindMany.mockReset()
  mockFindMany.mockImplementation(() => Promise.resolve([]))
  mockUpdate.mockReset()
  mockUpdate.mockImplementation(() => Promise.resolve({}))
})

describe('issueApiKey', () => {
  test('returns a 64-char raw key and stores prefix + hash, never the raw key', async () => {
    const { rawKey, id } = await issueApiKey('CI key', ['read'])
    expect(rawKey).toHaveLength(64)
    expect(id).toBe('key-1')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const { data } = mockCreate.mock.calls[0][0]
    expect(data.prefix).toBe(rawKey.slice(0, 8))
    expect(data.keyHash).toBe(sha256(rawKey))
    expect(data.scopes).toBe('["read"]')
    expect(JSON.stringify(data)).not.toContain(rawKey)
  })

  test('issues unique keys', async () => {
    const a = await issueApiKey('a', ['read'])
    const b = await issueApiKey('b', ['read'])
    expect(a.rawKey).not.toBe(b.rawKey)
  })
})

describe('validateApiKey', () => {
  test('returns null when key not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    expect(await validateApiKey('unknown-key', 'read')).toBeNull()
  })

  test('returns null when key hash does not match', async () => {
    const rawKey = 'a'.repeat(64)
    mockFindUnique.mockResolvedValueOnce(makeRecord(rawKey, { keyHash: 'wrong-hash' }))
    expect(await validateApiKey(rawKey, 'read')).toBeNull()
  })

  test('returns null for a revoked key even with matching hash', async () => {
    const rawKey = 'b'.repeat(64)
    mockFindUnique.mockResolvedValueOnce(makeRecord(rawKey, { revokedAt: new Date() }))
    expect(await validateApiKey(rawKey, 'read')).toBeNull()
  })

  test('returns null when the required scope is missing', async () => {
    const rawKey = 'c'.repeat(64)
    mockFindUnique.mockResolvedValueOnce(makeRecord(rawKey, { scopes: '["read"]' }))
    expect(await validateApiKey(rawKey, 'write')).toBeNull()
  })

  test('returns id and scopes for a valid key with the required scope', async () => {
    const rawKey = 'd'.repeat(64)
    mockFindUnique.mockResolvedValueOnce(makeRecord(rawKey, { scopes: '["read","write"]' }))
    const result = await validateApiKey(rawKey, 'write')
    expect(result).toEqual({ id: 'key-1', scopes: ['read', 'write'] })
  })

  test('returns null for corrupt scopes JSON', async () => {
    const rawKey = 'e'.repeat(64)
    mockFindUnique.mockResolvedValueOnce(makeRecord(rawKey, { scopes: 'not-json' }))
    expect(await validateApiKey(rawKey, 'read')).toBeNull()
  })
})

describe('listApiKeys', () => {
  test('returns summaries without key hashes', async () => {
    mockFindMany.mockResolvedValueOnce([makeRecord('f'.repeat(64))])
    const list = await listApiKeys()
    expect(list).toHaveLength(1)
    expect(list[0].prefix).toBe('ffffffff')
    expect(list[0].scopes).toEqual(['read'])
    expect(JSON.stringify(list[0])).not.toContain(sha256('f'.repeat(64)))
  })
})

describe('revokeApiKey', () => {
  test('sets revokedAt and returns true', async () => {
    expect(await revokeApiKey('key-1')).toBe(true)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const { where, data } = mockUpdate.mock.calls[0][0]
    expect(where).toEqual({ id: 'key-1' })
    expect(data.revokedAt).toBeInstanceOf(Date)
  })

  test('returns false for unknown id', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('not found'))
    expect(await revokeApiKey('nope')).toBe(false)
  })
})
