# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured stdout logging (Pino), OpenTelemetry instrumentation for API routes and adapter calls, and trace context propagation from HTTP request through SQLite task row to daemon execution.

**Architecture:** A singleton Pino logger in `src/lib/logger.ts` replaces scattered `console.error`/`console.info` calls. `@vercel/otel` instruments Next.js API routes via `src/instrumentation.ts`. Adapter dispatch is wrapped in an OTel span that records model, tokens, and cost. Trace context is serialized into the task's `traceContext` JSON column at enqueue and restored by the daemon at dequeue.

**Tech Stack:** Pino v10, `@vercel/otel`, `@opentelemetry/api`, Next.js 16, TypeScript 5, Bun 1.3.4

---

## File Map

| File | Change |
|---|---|
| `package.json` | Add `pino`, `@vercel/otel`, `@opentelemetry/api` |
| `src/lib/logger.ts` | New — singleton Pino logger + child loggers |
| `src/instrumentation.ts` | Modify — add `registerOTel` for Next.js tracing |
| `src/lib/server/activity-logger.ts` | Modify — call `logger.info` alongside DB write |
| `prisma/schema.prisma` | Add `traceContext String?` to `TaskStep` |
| `src/lib/server/dispatch.ts` | Propagate trace context at step enqueue |
| `src/lib/server/adapters/dispatch-telemetry.ts` | New — OTel-wrapped adapter dispatch helper |
| `src/lib/server/__tests__/logger.test.ts` | New — logger smoke tests |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via bun add)

- [ ] **Step 1: Install Pino**

```bash
cd /mnt/c/Projects/AgentBoard && bun add pino
bun add -d @types/pino
```

- [ ] **Step 2: Install OpenTelemetry packages**

```bash
bun add @vercel/otel @opentelemetry/api
```

- [ ] **Step 3: Verify installation**

```bash
bun run type-check 2>&1 | grep "pino\|otel" | head -5
```

Expected: no errors from these packages.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add pino and @vercel/otel dependencies for structured observability"
```

---

### Task 2: Singleton Pino logger

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/server/__tests__/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/__tests__/logger.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { logger, daemonLogger } from '@/lib/logger'

describe('logger', () => {
  test('root logger has correct base fields', () => {
    // pino loggers expose their bindings
    const bindings = (logger as { bindings?: () => Record<string, unknown> }).bindings?.()
    expect(bindings?.service).toBe('agentboard')
  })

  test('daemonLogger is a child of logger', () => {
    const bindings = (daemonLogger as { bindings?: () => Record<string, unknown> }).bindings?.()
    expect(bindings?.component).toBe('daemon')
  })

  test('logger has an info method', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/logger.test.ts
```

Expected: FAIL — `@/lib/logger` not found.

- [ ] **Step 3: Write `src/lib/logger.ts`**

```typescript
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'agentboard',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // No transport block — write JSON to stdout in all envs.
  // Pipe through `| pino-pretty` locally if desired.
})

export const daemonLogger = logger.child({ component: 'daemon' })
export const adapterLogger = logger.child({ component: 'adapter' })
export const reactionLogger = logger.child({ component: 'reaction' })
export const wizardLogger = logger.child({ component: 'wizard' })
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/logger.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts src/lib/server/__tests__/logger.test.ts
git commit -m "feat(observability): add singleton Pino logger with child loggers per component"
```

---

### Task 3: OpenTelemetry instrumentation for Next.js routes

**Files:**
- Modify: `src/instrumentation.ts`

`@vercel/otel`'s `registerOTel` auto-instruments every Next.js API route handler and all `fetch()` calls made inside them. It must be in `instrumentation.ts` at the project root (not inside `src/`).

- [ ] **Step 1: Check if `instrumentation.ts` exists at project root**

```bash
ls /mnt/c/Projects/AgentBoard/instrumentation.ts 2>/dev/null || echo "missing"
```

- [ ] **Step 2: Write/update `instrumentation.ts`**

If the file doesn't exist, create it at the project root (same level as `package.json`):

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate required env vars at startup (skip in test to avoid noise)
    if (process.env.NODE_ENV !== 'test') {
      await import('./src/lib/env')
    }

    // Register OpenTelemetry. OTEL_EXPORTER_OTLP_ENDPOINT controls where
    // traces go. Unset = traces are collected but not exported (safe default).
    const { registerOTel } = await import('@vercel/otel')
    registerOTel({
      serviceName: 'agentboard-web',
    })
  }
}
```

**Note:** If `src/instrumentation.ts` exists from a previous plan (security-pass), move the `env` import there and add the `registerOTel` call alongside it. Do not create two `instrumentation.ts` files.

- [ ] **Step 3: Add `instrumentationHook` to `next.config` if not already present**

```bash
grep -n "instrumentationHook" next.config.ts next.config.mjs next.config.js 2>/dev/null | head
```

If absent, add it. For `next.config.ts`:

```typescript
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  // ... existing config
}
```

- [ ] **Step 4: Type-check**

```bash
bun run type-check 2>&1 | grep "instrumentation"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts next.config.ts
git commit -m "feat(observability): register @vercel/otel in instrumentation.ts for route tracing"
```

---

### Task 4: Replace console calls with structured logger

**Files:**
- Modify: `src/lib/server/activity-logger.ts`
- Modify: `src/lib/server/reactions/executor.ts`
- Modify: `src/app/api/` route handlers using `console.error`

- [ ] **Step 1: Find all console.error/info calls in server code**

```bash
grep -rn "console\.error\|console\.warn\|console\.info\|console\.log" \
  src/lib/server/ src/app/api/ --include="*.ts" | grep -v "__tests__" | grep -v node_modules
```

Note the count — these are the targets to replace.

- [ ] **Step 2: Update `src/lib/server/activity-logger.ts` to log on writes**

Add a `logger.info` call alongside each `db.activityLog.create`:

```typescript
import { logger } from '@/lib/logger'

export async function writeLog(input: WriteLogInput): Promise<void> {
  await db.activityLog.create({ data: { ... } })

  logger.info({
    component: input.component,
    traceId: input.traceId,
    taskId: input.taskId,
    agentId: input.agentId,
    action: input.action,
  }, `[${input.level ?? 'info'}] ${input.action}`)
}
```

- [ ] **Step 3: Replace `console.error` in route handlers**

For each route handler that uses `console.error('[route-name]', e)`, replace with:

```typescript
import { logger } from '@/lib/logger'

// replace:
console.error('[wizard/compose]', e)
// with:
logger.error({ err: e, route: 'wizard/compose' }, 'Unhandled error in route handler')
```

The `err` field is Pino's convention for serializing Error objects (it captures `message`, `stack`, and `name`).

- [ ] **Step 4: Run the full test suite to confirm nothing broken**

```bash
bun test
```

Expected: all tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/activity-logger.ts src/lib/server/reactions/ src/app/api/
git commit -m "feat(observability): replace console.error/info with structured Pino logger calls"
```

---

### Task 5: Trace context propagation through SQLite task boundary

**Files:**
- Modify: `prisma/schema.prisma` — add `traceContext` to `TaskStep`
- Modify: `src/lib/server/dispatch.ts` — inject trace context at enqueue
- Modify: daemon step pickup (wherever `db.taskStep.findFirst` polls for work) — restore context

This links a user's HTTP request trace to the daemon's execution span, giving one unified trace from browser to LLM response.

- [ ] **Step 1: Add `traceContext` to `TaskStep` in schema**

```prisma
// Inside TaskStep model:
traceContext String? // JSON: W3C traceparent propagation carrier
```

- [ ] **Step 2: Push and regenerate**

```bash
bun run db:push && bun run db:generate
```

- [ ] **Step 3: Inject trace context at step creation in `dispatch.ts`**

```typescript
import { context, propagation } from '@opentelemetry/api'

// When creating or updating a TaskStep to 'leased' or 'pending' status:
const carrier: Record<string, string> = {}
propagation.inject(context.active(), carrier)

await db.taskStep.update({
  where: { id: stepId },
  data: {
    // ... existing fields
    traceContext: JSON.stringify(carrier),
  },
})
```

- [ ] **Step 4: Restore trace context in daemon step dequeue**

Find where the daemon picks up a step (`db.taskStep.findFirst` or the polling query in `src/app/api/daemon/steps/next/route.ts`). After retrieving the step, restore context before creating spans:

```typescript
import { context, propagation, trace } from '@opentelemetry/api'

const carrier: Record<string, string> = JSON.parse(step.traceContext ?? '{}')
const parentCtx = propagation.extract(context.active(), carrier)

const tracer = trace.getTracer('daemon')
tracer.startActiveSpan('daemon.execute_step', {}, parentCtx, async (span) => {
  span.setAttributes({ 'step.id': step.id, 'step.mode': step.mode })
  try {
    // ... existing step execution logic
    span.end()
  } catch (err) {
    span.recordException(err as Error)
    span.end()
    throw err
  }
})
```

- [ ] **Step 5: Type-check and full test run**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma/ src/lib/server/dispatch.ts src/app/api/daemon/
git commit -m "feat(observability): propagate W3C trace context through SQLite task row to daemon"
```
