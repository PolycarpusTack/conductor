# Security Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSRF protection to admin mutation endpoints, a startup secret validator that fails fast if required env vars are missing, and a per-key scope system for API integrations.

**Architecture:** CSRF: an `assertSameOrigin` guard in `src/lib/csrf.ts` applied to every POST/PUT/PATCH/DELETE admin route handler. Startup validation: a Zod schema in `src/lib/env.ts` parsed at import time (called from `src/instrumentation.ts`). Scoped API keys: a new `ApiKey` Prisma model with prefix (plaintext, for lookup) and key hash (SHA-256), plus a scope array stored as a JSON column.

**Tech Stack:** Prisma 7, SQLite, TypeScript 5, Zod 4, Node.js `crypto`, Bun 1.3.4

---

## File Map

| File | Change |
|---|---|
| `src/lib/csrf.ts` | New — `assertSameOrigin(req)` |
| `src/lib/env.ts` | New — Zod startup env validation |
| `src/instrumentation.ts` | New (or modify) — import `@/lib/env` to trigger validation at startup |
| `prisma/schema.prisma` | New `ApiKey` model |
| `src/lib/server/scoped-api-keys.ts` | New — issue, validate, list, revoke scoped keys |
| `src/app/api/admin/api-keys/route.ts` | New — REST endpoints for scoped key management |
| `src/lib/server/__tests__/csrf.test.ts` | New |
| `src/lib/server/__tests__/scoped-api-keys.test.ts` | New |

---

### Task 1: CSRF origin check

**Files:**
- Create: `src/lib/csrf.ts`
- Create: `src/lib/server/__tests__/csrf.test.ts`

`SameSite=Lax` blocks cross-site form POSTs in browsers but does not protect API routes called from non-browser clients or older browsers. An explicit origin check is the defense-in-depth layer.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/__tests__/csrf.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { assertSameOrigin } from '@/lib/csrf'

function makeReq(origin: string | null, host: string = 'localhost') {
  const headers = new Headers({ host })
  if (origin !== null) headers.set('origin', origin)
  return new Request('http://localhost/api/test', { headers })
}

describe('assertSameOrigin', () => {
  test('passes for matching origin and host', () => {
    expect(() => assertSameOrigin(makeReq('http://localhost'))).not.toThrow()
  })

  test('passes when origin header is absent (non-browser client)', () => {
    expect(() => assertSameOrigin(makeReq(null))).not.toThrow()
  })

  test('throws for cross-origin request', () => {
    expect(() => assertSameOrigin(makeReq('https://evil.com'))).toThrow()
  })

  test('passes for matching origin with port', () => {
    expect(() => assertSameOrigin(makeReq('http://localhost:3000', 'localhost:3000'))).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/csrf.test.ts
```

Expected: FAIL — `assertSameOrigin` not found.

- [ ] **Step 3: Write `src/lib/csrf.ts`**

```typescript
import { NextResponse } from 'next/server'

export class CsrfError extends Error {
  readonly status = 403
  constructor() { super('Cross-origin request blocked') }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (!origin) return // non-browser clients: no origin header is sent, allow through

  const host = request.headers.get('host')
  if (!host) return // shouldn't happen in practice

  const originHost = new URL(origin).host
  if (originHost !== host) {
    throw new CsrfError()
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/csrf.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Apply `assertSameOrigin` to admin mutation routes**

The routes that perform state-changing operations and are authenticated via session (not API key) need this guard. Add it as the first call after `requireAdminSession` in each:

- `src/app/api/projects/[id]/route.ts` — PUT and DELETE handlers
- `src/app/api/tasks/[id]/route.ts` — PUT and DELETE handlers
- `src/app/api/agents/[id]/route.ts` — PUT and DELETE handlers
- `src/app/api/agent-wizard/compose/route.ts` — POST handler
- `src/app/api/activity/purge/route.ts` — POST handler

For each file, add after `if (unauthorized) return unauthorized`:

```typescript
import { assertSameOrigin, CsrfError } from '@/lib/csrf'

// In the handler:
try { assertSameOrigin(request) } catch {
  return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
}
```

- [ ] **Step 6: Type-check and full test run**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/csrf.ts src/lib/server/__tests__/csrf.test.ts
git add src/app/api/projects src/app/api/tasks src/app/api/agents src/app/api/agent-wizard src/app/api/activity
git commit -m "feat(security): add CSRF origin check to all admin mutation routes"
```

---

### Task 2: Startup environment variable validation

**Files:**
- Create: `src/lib/env.ts`
- Create or modify: `src/instrumentation.ts`

A missing `SESSION_SECRET` or `DATABASE_URL` should kill the process at boot, not cause a confusing runtime error on the first request.

- [ ] **Step 1: Write `src/lib/env.ts`**

```typescript
import { z } from 'zod'

const serverEnvSchema = z.object({
  DATABASE_URL:     z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET:   z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  NODE_ENV:         z.enum(['development', 'test', 'production']).default('development'),
  // Optional but validated when present:
  PROMPT_LIBRARY_PATH: z.string().optional(),
  AGENTBOARD_WS_INTERNAL_SECRET: z.string().min(16).optional(),
})

// Throws at import time if any required var is missing.
// This runs once at server startup via instrumentation.ts.
export const env = serverEnvSchema.parse({
  DATABASE_URL:     process.env.DATABASE_URL,
  SESSION_SECRET:   process.env.SESSION_SECRET,
  NODE_ENV:         process.env.NODE_ENV,
  PROMPT_LIBRARY_PATH: process.env.PROMPT_LIBRARY_PATH,
  AGENTBOARD_WS_INTERNAL_SECRET: process.env.AGENTBOARD_WS_INTERNAL_SECRET,
})
```

- [ ] **Step 2: Create or modify `src/instrumentation.ts`**

Next.js calls `register()` from `instrumentation.ts` once at server startup. Importing `@/lib/env` here triggers the validation.

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate required env vars at startup. Throws if any are missing.
    // Skip in test environment where env vars may not be set.
    if (process.env.NODE_ENV !== 'test') {
      await import('@/lib/env')
    }
  }
}
```

- [ ] **Step 3: Verify no type errors**

```bash
bun run type-check 2>&1 | grep "env.ts\|instrumentation"
```

Expected: no output.

- [ ] **Step 4: Verify the validation throws on a bad input (manual test)**

```bash
node -e "process.env.DATABASE_URL=''; require('./src/lib/env.ts')" 2>&1 | head -5
```

Expected: Zod validation error mentioning `DATABASE_URL`.

- [ ] **Step 5: Add `.env.example`**

```bash
cat > .env.example << 'EOF'
# Required
DATABASE_URL=file:./prisma/dev.db
SESSION_SECRET=change-me-at-least-32-characters-long

# Optional
NODE_ENV=development
PROMPT_LIBRARY_PATH=/path/to/your/prompt/archive
AGENTBOARD_WS_INTERNAL_SECRET=change-me-16-chars
LOG_LEVEL=info
EOF
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts src/instrumentation.ts .env.example
git commit -m "feat(security): add Zod startup env validation and .env.example"
```

---

### Task 3: Scoped API keys schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `ApiKey` model to schema**

```prisma
model ApiKey {
  id        String   @id @default(cuid())
  prefix    String   @unique         // first 8 chars of the raw key, plaintext — for O(1) lookup
  keyHash   String   @unique         // SHA-256 of the full raw key — never store the raw key
  label     String
  scopes    String   @default("[]") // JSON: ["read", "write", "mcp:execute"]
  createdAt DateTime @default(now())
  lastUsedAt DateTime?
}
```

- [ ] **Step 2: Push and regenerate**

```bash
bun run db:push && bun run db:generate
```

Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Verify no type errors**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma/
git commit -m "feat(schema): add ApiKey model for scoped API key management"
```

---

### Task 4: Scoped API key service

**Files:**
- Create: `src/lib/server/scoped-api-keys.ts`
- Create: `src/lib/server/__tests__/scoped-api-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/__tests__/scoped-api-keys.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test'

const mockCreate = mock(() => Promise.resolve({ id: 'key-1', prefix: 'abcd1234', keyHash: 'hash', label: 'CI', scopes: '["read"]', createdAt: new Date(), lastUsedAt: null }))
const mockFindUnique = mock(() => Promise.resolve(null))
const mockUpdate = mock(() => Promise.resolve({}))

mock.module('@/lib/db', () => ({
  db: { apiKey: { create: mockCreate, findUnique: mockFindUnique, update: mockUpdate } },
}))

import { issueApiKey, validateApiKey } from '../scoped-api-keys'

describe('issueApiKey', () => {
  test('returns a raw key starting with the prefix', async () => {
    const { rawKey } = await issueApiKey('CI key', ['read'])
    expect(rawKey.length).toBeGreaterThan(8)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const { data } = mockCreate.mock.calls[0][0]
    expect(data.prefix).toBe(rawKey.slice(0, 8))
  })
})

describe('validateApiKey', () => {
  test('returns null when key not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const result = await validateApiKey('unknown-key', 'read')
    expect(result).toBeNull()
  })

  test('returns null when key hash does not match', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'key-1', prefix: 'abcd1234', keyHash: 'wrong-hash',
      label: 'CI', scopes: '["read"]', createdAt: new Date(), lastUsedAt: null,
    })
    const result = await validateApiKey('abcd1234xxxx', 'read')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/scoped-api-keys.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `src/lib/server/scoped-api-keys.ts`**

```typescript
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function issueApiKey(
  label: string,
  scopes: string[],
): Promise<{ rawKey: string; id: string }> {
  const rawKey = randomBytes(32).toString('hex') // 64-char hex string
  const prefix = rawKey.slice(0, 8)
  const keyHash = hashKey(rawKey)

  const created = await db.apiKey.create({
    data: { prefix, keyHash, label, scopes: JSON.stringify(scopes) },
  })

  return { rawKey, id: created.id }
}

export async function validateApiKey(
  rawKey: string,
  requiredScope: string,
): Promise<{ id: string; scopes: string[] } | null> {
  const prefix = rawKey.slice(0, 8)
  const record = await db.apiKey.findUnique({ where: { prefix } })
  if (!record) return null

  const expectedHash = hashKey(rawKey)
  if (record.keyHash !== expectedHash) return null

  const scopes: string[] = JSON.parse(record.scopes)
  if (!scopes.includes(requiredScope)) return null

  // Fire-and-forget lastUsedAt update
  void db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })

  return { id: record.id, scopes }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/scoped-api-keys.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Full test run**

```bash
bun test
```

Expected: all tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/scoped-api-keys.ts src/lib/server/__tests__/scoped-api-keys.test.ts
git commit -m "feat: add scoped API key service (issue, validate, scope check)"
```
