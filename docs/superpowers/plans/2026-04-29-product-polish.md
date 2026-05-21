# Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/api/health` endpoint, a runtime health-check endpoint, and a self-host install guide so the app can be verified after deployment and configured without tribal knowledge.

**Architecture:** The health endpoint queries the DB and checks required env vars, returning a structured JSON response that load balancers and monitoring can consume. The runtime health endpoint fires a minimal no-op dispatch through the configured adapter and reports latency and error. The install guide is a `INSTALL.md` at the repo root.

**Tech Stack:** Next.js 16 App Router, Prisma 7, TypeScript 5, Bun 1.3.4

---

## File Map

| File | Change |
|---|---|
| `src/app/api/health/route.ts` | New — `/api/health` public health check |
| `src/app/api/admin/runtimes/[id]/health/route.ts` | New — per-runtime health ping |
| `src/lib/server/__tests__/health.test.ts` | New — health check logic tests |
| `INSTALL.md` | New — self-host install guide |

---

### Task 1: Public health endpoint

**Files:**
- Create: `src/app/api/health/route.ts`
- Create: `src/lib/server/__tests__/health.test.ts`

The health endpoint must not require auth (load balancers call it), but must not expose secrets. It checks: DB connectivity (one cheap query), required env vars present, and application version.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/__tests__/health.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test'

const mockCount = mock(() => Promise.resolve(1))

mock.module('@/lib/db', () => ({
  db: { project: { count: mockCount } },
}))

import { getHealthStatus } from '../health'

describe('getHealthStatus', () => {
  test('returns ok when DB responds', async () => {
    mockCount.mockResolvedValueOnce(3)
    const status = await getHealthStatus()
    expect(status.status).toBe('ok')
    expect(status.db).toBe('ok')
  })

  test('returns degraded when DB throws', async () => {
    mockCount.mockRejectedValueOnce(new Error('DB is down'))
    const status = await getHealthStatus()
    expect(status.status).toBe('degraded')
    expect(status.db).toBe('error')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/health.test.ts
```

Expected: FAIL — `getHealthStatus` not found.

- [ ] **Step 3: Write `src/lib/server/health.ts`**

```typescript
import { db } from '@/lib/db'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  env: 'ok' | 'missing'
  missingEnvVars: string[]
  uptime: number
  timestamp: string
}

const REQUIRED_ENV = ['DATABASE_URL', 'SESSION_SECRET']

export async function getHealthStatus(): Promise<HealthStatus> {
  const missingEnvVars = REQUIRED_ENV.filter(k => !process.env[k])

  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    await db.project.count()
  } catch {
    dbStatus = 'error'
  }

  const envStatus = missingEnvVars.length === 0 ? 'ok' : 'missing'
  const overall = dbStatus === 'ok' && envStatus === 'ok' ? 'ok' : 'degraded'

  return {
    status: overall,
    db: dbStatus,
    env: envStatus,
    missingEnvVars,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/health.test.ts
```

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Write `src/app/api/health/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getHealthStatus } from '@/lib/server/health'

// No auth — this endpoint is called by load balancers and monitoring tools.
export async function GET() {
  const health = await getHealthStatus()
  const statusCode = health.status === 'ok' ? 200 : 503
  return NextResponse.json(health, { status: statusCode })
}
```

- [ ] **Step 6: Verify the endpoint is reachable (manual)**

Start the dev server in a separate terminal:
```bash
bun run dev
```

Then test:
```bash
curl -s http://localhost:3000/api/health | jq
```

Expected:
```json
{
  "status": "ok",
  "db": "ok",
  "env": "ok",
  "missingEnvVars": [],
  "uptime": 12.3,
  "timestamp": "2026-04-29T..."
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/health.ts src/lib/server/__tests__/health.test.ts src/app/api/health/route.ts
git commit -m "feat: add /api/health endpoint for load balancers and monitoring"
```

---

### Task 2: Runtime health ping endpoint

**Files:**
- Create: `src/app/api/admin/runtimes/[id]/health/route.ts`

This endpoint fires a minimal "echo" prompt at the configured runtime adapter and reports whether it responded, with latency.

- [ ] **Step 1: Locate the adapter dispatch pattern**

```bash
grep -n "getAdapter\|adapter.dispatch\|resolveRuntime" src/lib/server/wizard-composer.ts
```

Note the pattern for resolving and calling an adapter — this endpoint uses the same pattern.

- [ ] **Step 2: Create the directory structure**

```bash
mkdir -p src/app/api/admin/runtimes/\[id\]/health
```

- [ ] **Step 3: Write `src/app/api/admin/runtimes/[id]/health/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling, notFound } from '@/lib/server/api-errors'
import { db } from '@/lib/db'
import { getAdapter } from '@/lib/server/adapters/registry'
import { safeJsonParse } from '@/lib/server/utils'

export const GET = withErrorHandling(
  'api/admin/runtimes/[id]/health',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const runtime = await db.projectRuntime.findUnique({ where: { id } })
    if (!runtime) throw notFound('Runtime not found')

    const adapter = getAdapter(runtime.adapter)
    if (!adapter || !adapter.available) {
      return NextResponse.json({
        status: 'unavailable',
        adapter: runtime.adapter,
        latencyMs: null,
        error: `Adapter "${runtime.adapter}" is not available`,
      }, { status: 503 })
    }

    const model = (safeJsonParse<string[]>(runtime.models, []))[0] ?? 'default'
    const runtimeConfig: Record<string, unknown> = {
      ...safeJsonParse<Record<string, unknown>>(runtime.config, {}),
      apiKeyEnvVar: runtime.apiKeyEnvVar,
      endpoint: runtime.endpoint,
    }

    const start = Date.now()
    try {
      await adapter.dispatch({
        systemPrompt: 'You are a health check. Reply with only "ok".',
        taskContext: 'health check',
        mode: 'compose',
        model,
        runtimeConfig,
      })
      return NextResponse.json({
        status: 'ok',
        adapter: runtime.adapter,
        model,
        latencyMs: Date.now() - start,
      })
    } catch (err) {
      return NextResponse.json({
        status: 'error',
        adapter: runtime.adapter,
        model,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      }, { status: 502 })
    }
  },
)
```

- [ ] **Step 4: Type-check**

```bash
bun run type-check 2>&1 | grep "runtimes.*health"
```

Expected: no output (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/runtimes/
git commit -m "feat: add per-runtime health ping endpoint at /api/admin/runtimes/[id]/health"
```

---

### Task 3: Self-host install guide

**Files:**
- Create: `INSTALL.md`

- [ ] **Step 1: Write `INSTALL.md`**

```markdown
# AgentBoard — Install Guide

## Prerequisites

- [Bun](https://bun.sh) 1.3.4+
- Node.js 20+ (required by Next.js build)
- Git

## 1. Clone and install

```bash
git clone https://github.com/your-org/agentboard
cd agentboard
bun install        # also runs prisma generate via postinstall
```

## 2. Configure environment

Copy the example file and fill in required values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite path, e.g. `file:./prisma/dev.db` |
| `SESSION_SECRET` | Yes | Random string ≥ 32 chars. Generate: `openssl rand -hex 32` |
| `PROMPT_LIBRARY_PATH` | No | Absolute path to a folder of `.md` prompt files |
| `AGENTBOARD_WS_INTERNAL_SECRET` | No | Shared secret for internal WebSocket polling. Generate: `openssl rand -hex 16` |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error`. Default: `info` |

## 3. Initialize the database

```bash
bun run db:push
```

## 4. Start

**Development:**
```bash
bun run dev
```

**Production:**
```bash
bun run build
bun run start
```

## 5. Verify

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","db":"ok","env":"ok",...}`

## 6. Docker (optional)

```bash
docker compose up -d
```

The `docker-compose.yml` starts the app with a volume-mounted SQLite database. Set environment variables via a `.env` file in the project root.

## Upgrading

```bash
git pull
bun install
bun run db:push
bun run build
bun run start
```
```

- [ ] **Step 2: Commit**

```bash
git add INSTALL.md
git commit -m "docs: add self-host install guide with env var reference"
```
