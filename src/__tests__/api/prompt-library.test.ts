import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setSession, ADMIN_SESSION } from '../helpers/auth'
// The prompt-library module has its own real unit tests, so it must NOT be
// module-mocked (bun's mock registry is shared across the whole test run).
// A temp fixture directory + the env var exercises the real implementation.
import { clearListCache, listEntries } from '@/lib/server/prompt-library'

let fixtureDir: string
let originalEnv: string | undefined

beforeAll(() => {
  originalEnv = process.env.PROMPT_LIBRARY_PATH
  fixtureDir = mkdtempSync(join(tmpdir(), 'agentboard-auth-test-'))
  mkdirSync(join(fixtureDir, 'agents'))
  writeFileSync(join(fixtureDir, 'agents', 'helper.md'), '# Helper Agent\n\nA test prompt.\n')
  process.env.PROMPT_LIBRARY_PATH = fixtureDir
  clearListCache()
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.PROMPT_LIBRARY_PATH
  else process.env.PROMPT_LIBRARY_PATH = originalEnv
  clearListCache()
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe('GET /api/prompt-library — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/prompt-library/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/prompt-library/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.categories.length).toBeGreaterThan(0)
  })
})

describe('GET /api/prompt-library/[entryId] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/prompt-library/[entryId]/route')
    const res = await GET(new Request('http://localhost/api/prompt-library/x'), {
      params: Promise.resolve({ entryId: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns 200 for a real entry when authenticated', async () => {
    setSession(ADMIN_SESSION)
    clearListCache()
    const entryId = listEntries().categories[0].entries[0].id
    const { GET } = await import('@/app/api/prompt-library/[entryId]/route')
    const res = await GET(new Request(`http://localhost/api/prompt-library/${entryId}`), {
      params: Promise.resolve({ entryId }),
    })
    expect(res.status).toBe(200)
  })

  test('returns 404 for unknown entry when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/prompt-library/[entryId]/route')
    const res = await GET(new Request('http://localhost/api/prompt-library/does-not-exist'), {
      params: Promise.resolve({ entryId: 'does-not-exist' }),
    })
    expect(res.status).toBe(404)
  })
})
