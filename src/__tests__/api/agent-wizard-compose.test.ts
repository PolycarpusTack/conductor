import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// wizard-composer and prompt-library both have real unit tests elsewhere in
// the suite, so neither may be module-mocked here. The auth/CSRF/validation
// cases below never reach composeAgent, and a temp fixture dir satisfies
// validateLibraryPath. The happy-path 200 (LLM call) is covered by the
// wizard-composer unit tests instead.

let fixtureDir: string
let originalEnv: string | undefined

beforeAll(() => {
  originalEnv = process.env.PROMPT_LIBRARY_PATH
  fixtureDir = mkdtempSync(join(tmpdir(), 'agentboard-wizard-auth-'))
  writeFileSync(join(fixtureDir, 'sample.md'), '# Sample\n\nFixture prompt.\n')
  process.env.PROMPT_LIBRARY_PATH = fixtureDir
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.PROMPT_LIBRARY_PATH
  else process.env.PROMPT_LIBRARY_PATH = originalEnv
  rmSync(fixtureDir, { recursive: true, force: true })
})

const validBody = {
  purpose: 'A test agent for unit testing',
  domain: 'TypeScript',
  goal: 'run tests',
  runtimeId: 'r1',
}

describe('POST /api/agent-wizard/compose — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/agent-wizard/compose/route')
    const res = await POST(
      makeRequest('http://localhost/api/agent-wizard/compose', { method: 'POST', body: validBody }),
    )
    expect(res.status).toBe(401)
  })

  test('returns 403 for cross-origin request when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/agent-wizard/compose/route')
    const res = await POST(
      makeRequest('http://localhost/api/agent-wizard/compose', {
        method: 'POST',
        body: validBody,
        headers: { origin: 'https://evil.com' },
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 400 for invalid body when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/agent-wizard/compose/route')
    const res = await POST(
      makeRequest('http://localhost/api/agent-wizard/compose', { method: 'POST', body: { purpose: 'x' } }),
    )
    expect(res.status).toBe(400)
  })
})
