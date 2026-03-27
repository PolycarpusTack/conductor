# Observability & Cost Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-step token/cost tracking, runtime latency metrics, tool call traces, failure clustering, chain bottleneck analysis, and agent scorecards — so operators can see which agents and runtimes are performing.

**Architecture:** The `StepExecution` model (from the durable execution plan) already captures `tokensUsed`, `cost`, `durationMs`, and `error` per attempt. This plan builds on that data with aggregation APIs, a dashboard component, and tool call tracing.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), React 19, Tailwind 4, shadcn/ui, Recharts (already a dependency)

**Depends on:** Workstream 1 (Durable Execution) — needs the `StepExecution` model

---

## Task 1: Persist tokensUsed and cost on DispatchResult

**Files:**
- Modify: `src/lib/server/adapters/types.ts` — ensure `cost` is on DispatchResult (already there)
- Modify: all adapters — pass cost estimate based on token counts

Already partially done: adapters return `tokensUsed`. The `StepExecution` model stores it. This task ensures adapters also estimate `cost` where possible.

- [ ] **Step 1: Add cost estimation helper**

Create `src/lib/server/cost-estimator.ts`:

```typescript
// Rough per-token costs (input+output blended) by model family
const MODEL_COSTS: Record<string, number> = {
  'claude-sonnet': 0.000006,    // $6/M tokens blended
  'claude-haiku': 0.000002,     // $2/M tokens blended
  'claude-opus': 0.00003,       // $30/M tokens blended
  'gpt-4o': 0.000005,           // $5/M tokens blended
  'gpt-4o-mini': 0.0000003,     // $0.30/M tokens blended
  'gemini-2.0-flash': 0.0000003,
  'gemini-2.5-pro': 0.000003,
  'glm-4': 0.000001,
}

export function estimateCost(model: string, tokensUsed: number): number {
  const key = Object.keys(MODEL_COSTS).find(k => model.toLowerCase().includes(k))
  if (!key) return 0
  return tokensUsed * MODEL_COSTS[key]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/cost-estimator.ts
git commit -m "feat: add token cost estimation helper"
```

---

## Task 2: Add tool call trace logging

**Files:**
- Modify: `prisma/schema.prisma` — add ToolCallTrace model
- Create: `src/lib/server/tool-trace.ts`

- [ ] **Step 1: Add ToolCallTrace model**

```prisma
model ToolCallTrace {
  id            String    @id @default(cuid())
  executionId   String
  execution     StepExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)
  toolName      String
  args          String?   // JSON
  result        String?   // truncated
  durationMs    Int?
  error         String?
  createdAt     DateTime  @default(now())
}
```

Add relation to `StepExecution`:
```prisma
  toolCalls     ToolCallTrace[]
```

- [ ] **Step 2: Create tool-trace.ts**

```typescript
import { db } from '@/lib/db'

export async function traceToolCall(
  executionId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number,
  error?: string,
) {
  return db.toolCallTrace.create({
    data: {
      executionId,
      toolName,
      args: JSON.stringify(args),
      result: result.slice(0, 2000), // truncate large outputs
      durationMs,
      error: error || null,
    },
  })
}
```

- [ ] **Step 3: Wire tool tracing into adapters**

In each adapter's tool-use loop, wrap the `executeMcpTool` call with timing and call `traceToolCall`. This requires passing the `executionId` through `DispatchParams` (add it to the interface).

- [ ] **Step 4: Push schema, regenerate, commit**

```bash
bun run db:push --accept-data-loss && bun run db:generate
git add prisma/schema.prisma src/lib/server/tool-trace.ts src/generated/
git commit -m "feat: add tool call tracing with ToolCallTrace model"
```

---

## Task 3: Build aggregation APIs

**Files:**
- Create: `src/app/api/projects/[id]/analytics/route.ts`
- Create: `src/lib/server/analytics.ts`

- [ ] **Step 1: Create analytics.ts**

Aggregation functions:
- `getProjectStats(projectId)` — total tasks, completion rate, avg chain duration
- `getAgentScorecard(agentId)` — tasks completed, success rate, avg duration, avg tokens, total cost
- `getRuntimeStats(projectId)` — per-runtime: avg latency, error rate, total tokens, total cost
- `getFailureClusters(projectId)` — group step failures by error message pattern, count occurrences
- `getChainBottlenecks(projectId)` — identify which step modes/agents take the longest on average

All queries use raw SQL aggregations on `StepExecution` for performance.

- [ ] **Step 2: Create analytics API route**

`GET /api/projects/[id]/analytics?view=overview|agents|runtimes|failures|bottlenecks`

Returns the appropriate aggregation based on the `view` parameter.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/analytics.ts src/app/api/projects/[id]/analytics/route.ts
git commit -m "feat: add project analytics aggregation API"
```

---

## Task 4: Build observability dashboard component

**Files:**
- Create: `src/components/observability-dashboard.tsx`
- Modify: `src/app/page.tsx` — add dashboard tab to settings

- [ ] **Step 1: Create dashboard component**

Five sections using Recharts (already installed):

1. **Overview cards** — total tasks completed, total cost, avg chain duration, success rate
2. **Agent scorecards** — table with per-agent metrics (sortable by any column)
3. **Runtime performance** — bar chart of avg latency and error rate per runtime
4. **Failure clusters** — grouped error messages with frequency count and "last seen"
5. **Chain bottlenecks** — which step modes (analyze, develop, review) are slowest on average

Each section fetches from `/api/projects/[id]/analytics?view=<section>`.

- [ ] **Step 2: Wire into settings panel**

Add a new "Analytics" tab in the project settings section of page.tsx.

- [ ] **Step 3: Commit**

```bash
git add src/components/observability-dashboard.tsx src/app/page.tsx
git commit -m "feat: add observability dashboard with agent scorecards, runtime stats, and failure clustering"
```

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `cost-estimator.ts` | Token cost estimation by model |
| 2 | `schema.prisma`, `tool-trace.ts` | ToolCallTrace model + tracing helper |
| 3 | `analytics.ts`, `analytics/route.ts` | Aggregation APIs for project/agent/runtime stats |
| 4 | `observability-dashboard.tsx`, `page.tsx` | Dashboard UI with charts and scorecards |
