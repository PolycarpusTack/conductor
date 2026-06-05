# Auth Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a reusable auth test helper and endpoint-level auth tests so any route missing `requireAdminSession()` is caught by CI before it reaches production.

**Architecture:** A single `withSession` helper in `src/__tests__/helpers/auth.ts` mocks `@/lib/server/admin-session` at module level. Each protected API route gets a test file with three standard cases: unauthenticated → 401, authenticated → 2xx. The pattern uses Bun's `mock.module` to intercept the session check before the route handler runs.

**Tech Stack:** Bun 1.3.4 test runner (`bun test`), `mock.module` from `bun:test`, Next.js App Router route handlers

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - `setSession` registers the admin-session mock ONCE at helper import and flips a mutable variable, instead of re-registering `mock.module` per test — more robust against bun's shared module registry.
> - Added cross-origin 403 cases for the mutation routes (wizard compose, activity purge, project PUT/DELETE), covering the CSRF guard added in the security pass; `makeRequest` defaults to same-origin headers.
> - **bun gotcha:** the `mock.module` registry is shared across ALL test files in one run. Two consequences, both encoded in comments: (1) every mock factory must expose the full export surface of the real module (a narrow factory crashes later importers with a SyntaxError); (2) modules that have real unit tests elsewhere (`prompt-library`, `wizard-composer`) must NOT be module-mocked at all — the prompt-library auth tests use a temp fixture dir + `PROMPT_LIBRARY_PATH` against the real implementation instead.
> - The compose happy-path 200 test was dropped (it would invoke the real LLM composer); the composer is covered by its own unit tests. Compose auth coverage is 401/403/400.
> - The activity GET route's fire-and-forget import is `purgeProjectLogs`, not `purgeOldLogs` as the plan's mock assumed; the mock covers both plus `writeLog`.
> - Also covers `GET /api/prompt-library/[entryId]` (in File Map but missing from the task list), including 200 with a real fixture entry and the 404 path.

---

## File Map

| File | Change |
|---|---|
| `src/__tests__/helpers/auth.ts` | New — `withSession` / `withNoSession` helpers |
| `src/__tests__/api/prompt-library.test.ts` | New — auth tests for GET /api/prompt-library |
| `src/__tests__/api/prompt-library-entry.test.ts` | New — auth tests for GET /api/prompt-library/[entryId] |
| `src/__tests__/api/agent-wizard-compose.test.ts` | New — auth tests for POST /api/agent-wizard/compose |
| `src/__tests__/api/activity.test.ts` | New — auth tests for GET /api/activity |
| `src/__tests__/api/activity-purge.test.ts` | New — auth tests for POST /api/activity/purge |
| `src/__tests__/api/projects.test.ts` | New — auth tests for GET/PUT/DELETE /api/projects/[id] |

---

### Task 1: Build the auth test helper

**Files:**
- Create: `src/__tests__/helpers/auth.ts`

This helper must be called **before** importing the route under test, because `mock.module` only intercepts imports that happen after the mock is registered. All test files will call `setSession` at the top of the file using a dynamic import pattern.

- [x] **Step 1: Create the directory**

```bash
mkdir -p src/__tests__/helpers src/__tests__/api
```

- [x] **Step 2: Write `src/__tests__/helpers/auth.ts`**

```typescript
import { mock } from 'bun:test'
import { NextResponse } from 'next/server'

export type SessionFixture = { id: string; role: string } | null

export const ADMIN_SESSION: SessionFixture = { id: 'user-1', role: 'admin' }

/**
 * Call this at the top of a test file, before the route import.
 * Registers a mock for @/lib/server/admin-session so requireAdminSession()
 * returns the given fixture (or a 401 response if null).
 */
export function setSession(fixture: SessionFixture) {
  mock.module('@/lib/server/admin-session', () => ({
    requireAdminSession: fixture
      ? () => Promise.resolve(null)
      : () => Promise.resolve(NextResponse.json({ error: 'Unauthorized' }, { status: 401 })),
  }))
}

export function makeRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'host': 'localhost',
      'origin': 'http://localhost',
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}
```

- [x] **Step 3: Verify the file type-checks**

```bash
bun run type-check 2>&1 | grep "__tests__/helpers/auth"
```

Expected: no output (no errors).

- [x] **Step 4: Commit**

```bash
git add src/__tests__/helpers/auth.ts
git commit -m "test: add withSession auth helper for endpoint-level auth tests"
```

---

### Task 2: Auth tests for prompt-library routes

**Files:**
- Create: `src/__tests__/api/prompt-library.test.ts`

The `requireAdminSession` mock must be registered before the route module is imported. Bun evaluates `mock.module` synchronously but the import must be dynamic (`await import(...)`) so it happens after the mock.

- [x] **Step 1: Mock the library path validation too**

The prompt-library routes also call `validateLibraryPath()`. For auth tests we only care about auth, so mock that as well.

- [x] **Step 2: Write `src/__tests__/api/prompt-library.test.ts`**

```typescript
import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'
import { NextResponse } from 'next/server'

// Mock prompt-library service so validateLibraryPath doesn't fail
mock.module('@/lib/server/prompt-library', () => ({
  validateLibraryPath: () => null,
  listEntries: () => ({ categories: [] }),
  getEntry: () => null,
}))

describe('GET /api/prompt-library — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/prompt-library/route')
    const res = await GET(makeRequest('http://localhost/api/prompt-library'))
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/prompt-library/route')
    const res = await GET(makeRequest('http://localhost/api/prompt-library'))
    expect(res.status).toBe(200)
  })
})
```

- [x] **Step 3: Run the test**

```bash
bun test src/__tests__/api/prompt-library.test.ts
```

Expected: 2 pass, 0 fail.

- [x] **Step 4: Write `src/__tests__/api/agent-wizard-compose.test.ts`**

```typescript
import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

mock.module('@/lib/server/prompt-library', () => ({
  validateLibraryPath: () => null,
}))

mock.module('@/lib/server/wizard-composer', () => ({
  composeAgent: () => Promise.resolve({
    name: 'Test Agent', role: 'developer', personality: 'focused',
    capabilities: [], systemPrompt: 'You are a test agent.', sourcesUsed: [],
  }),
}))

describe('POST /api/agent-wizard/compose — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/agent-wizard/compose/route')
    const res = await POST(makeRequest('http://localhost/api/agent-wizard/compose', {
      method: 'POST',
      body: { purpose: 'A test agent for unit testing', domain: 'TypeScript', goal: 'run tests', runtimeId: 'r1' },
    }))
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated with valid body', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/agent-wizard/compose/route')
    const res = await POST(makeRequest('http://localhost/api/agent-wizard/compose', {
      method: 'POST',
      body: { purpose: 'A test agent for unit testing', domain: 'TypeScript', goal: 'run tests', runtimeId: 'r1' },
    }))
    expect(res.status).toBe(200)
  })
})
```

- [x] **Step 5: Run both new test files**

```bash
bun test src/__tests__/api/
```

Expected: all tests pass, 0 fail.

- [x] **Step 6: Commit**

```bash
git add src/__tests__/api/prompt-library.test.ts src/__tests__/api/agent-wizard-compose.test.ts
git commit -m "test: add endpoint auth tests for prompt-library and agent-wizard routes"
```

---

### Task 3: Auth tests for activity routes

**Files:**
- Create: `src/__tests__/api/activity.test.ts`
- Create: `src/__tests__/api/activity-purge.test.ts`

- [x] **Step 1: Write `src/__tests__/api/activity.test.ts`**

```typescript
import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

mock.module('@/lib/db', () => ({
  db: {
    activityLog: {
      findMany: () => Promise.resolve([]),
    },
    project: {
      findUnique: () => Promise.resolve({ logRetentionDays: null }),
    },
  },
}))

mock.module('@/lib/server/activity-logger', () => ({
  purgeProjectLogs: () => Promise.resolve(null),
}))

describe('GET /api/activity — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(makeRequest('http://localhost/api/activity?projectId=proj-1'))
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(makeRequest('http://localhost/api/activity?projectId=proj-1'))
    expect(res.status).toBe(200)
  })
})
```

- [x] **Step 2: Write `src/__tests__/api/activity-purge.test.ts`**

```typescript
import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

mock.module('@/lib/server/activity-logger', () => ({
  purgeOldLogs: () => Promise.resolve(5),
}))

describe('POST /api/activity/purge — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/activity/purge/route')
    const res = await POST(makeRequest('http://localhost/api/activity/purge', {
      method: 'POST',
      body: { projectId: 'proj-1', retentionDays: 30 },
    }))
    expect(res.status).toBe(401)
  })

  test('returns 200 with deleted count when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/activity/purge/route')
    const res = await POST(makeRequest('http://localhost/api/activity/purge', {
      method: 'POST',
      body: { projectId: 'proj-1', retentionDays: 30 },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(5)
  })
})
```

- [x] **Step 3: Run all auth tests**

```bash
bun test src/__tests__/api/
```

Expected: all tests pass.

- [x] **Step 4: Commit**

```bash
git add src/__tests__/api/activity.test.ts src/__tests__/api/activity-purge.test.ts
git commit -m "test: add endpoint auth tests for activity routes"
```

---

### Task 4: Auth tests for projects route

**Files:**
- Create: `src/__tests__/api/projects.test.ts`

- [x] **Step 1: Write `src/__tests__/api/projects.test.ts`**

```typescript
import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const mockProject = {
  id: 'proj-1', name: 'Test', description: null, color: '#3b82f6',
  agents: [], tasks: [],
}

mock.module('@/lib/db', () => ({
  db: {
    project: {
      findUnique: () => Promise.resolve(mockProject),
      update: () => Promise.resolve(mockProject),
      delete: () => Promise.resolve({}),
    },
  },
}))

const projectParams = { params: Promise.resolve({ id: 'proj-1' }) }

describe('GET /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/projects/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { PUT } = await import('@/app/api/projects/[id]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/proj-1', { method: 'PUT', body: { name: 'Updated' } }),
      projectParams,
    )
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { DELETE } = await import('@/app/api/projects/[id]/route')
    const res = await DELETE(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(401)
  })
})
```

- [x] **Step 2: Run all tests to confirm nothing broken**

```bash
bun test
```

Expected: 179+ tests pass, 0 fail.

- [x] **Step 3: Commit**

```bash
git add src/__tests__/api/projects.test.ts src/__tests__/helpers/auth.ts
git commit -m "test: add endpoint auth tests for projects route"
```
