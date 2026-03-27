# Workflow Branching & Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade chains from linear sequences to DAGs with conditional branching, parallel branches, merge/join steps, fallback agents, and policy rules like "send to QA only if risk is high."

**Architecture:** Replace the linear `order` field on TaskStep with a DAG model. Each step has `nextSteps` (JSON array of conditional edges) instead of implicit order-based advancement. A new `StepCondition` evaluates output from the previous step to decide which branch to take. Parallel branches use a merge step that waits for all incoming edges. The `advanceChain` function becomes a DAG walker.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui

**Note:** This is the most complex workstream. It changes the chain execution model fundamentally. Should be done after durable execution is stable.

---

## Task 1: Extend TaskStep schema for DAG edges

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add DAG fields to TaskStep**

```prisma
  // DAG fields (coexist with linear 'order' for backward compatibility)
  nextSteps       String?   // JSON: Array<{ stepId: string; condition?: string }>
  prevSteps       String?   // JSON: Array<string> — for merge/join detection
  isParallelRoot  Boolean   @default(false)  // starts a parallel branch
  isMergePoint    Boolean   @default(false)  // waits for all prevSteps to complete
  fallbackAgentId String?   // if this step fails, try this agent instead
```

- [ ] **Step 2: Add condition schema**

```typescript
export const stepEdgeSchema = z.object({
  targetStepId: z.string(),
  condition: z.object({
    field: z.enum(['output', 'status', 'tokensUsed', 'error']),
    operator: z.enum(['contains', 'not_contains', 'equals', 'gt', 'lt', 'matches']),
    value: z.string(),
  }).optional(), // no condition = unconditional (default path)
  label: z.string().max(60).optional(), // "if high risk", "if approved"
})
```

- [ ] **Step 3: Push schema, regenerate, commit**

```bash
bun run db:push --accept-data-loss && bun run db:generate
git add prisma/schema.prisma src/lib/server/contracts.ts src/generated/
git commit -m "feat: extend TaskStep with DAG edges, merge points, and fallback agents"
```

---

## Task 2: Implement condition evaluator

**Files:**
- Create: `src/lib/server/condition-evaluator.ts`

- [ ] **Step 1: Create condition evaluator**

```typescript
interface StepCondition {
  field: 'output' | 'status' | 'tokensUsed' | 'error'
  operator: 'contains' | 'not_contains' | 'equals' | 'gt' | 'lt' | 'matches'
  value: string
}

interface StepContext {
  output?: string | null
  status: string
  tokensUsed?: number | null
  error?: string | null
}

export function evaluateCondition(condition: StepCondition, context: StepContext): boolean {
  const fieldValue = context[condition.field]
  const strValue = String(fieldValue ?? '')

  switch (condition.operator) {
    case 'contains':
      return strValue.toLowerCase().includes(condition.value.toLowerCase())
    case 'not_contains':
      return !strValue.toLowerCase().includes(condition.value.toLowerCase())
    case 'equals':
      return strValue === condition.value
    case 'gt':
      return Number(fieldValue) > Number(condition.value)
    case 'lt':
      return Number(fieldValue) < Number(condition.value)
    case 'matches':
      try { return new RegExp(condition.value, 'i').test(strValue) }
      catch { return false }
    default:
      return false
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/condition-evaluator.ts
git commit -m "feat: add step condition evaluator for workflow branching"
```

---

## Task 3: Rewrite advanceChain as DAG walker

**Files:**
- Modify: `src/lib/server/dispatch.ts`

- [ ] **Step 1: Add DAG-aware chain advancement**

Replace the linear `advanceChain` with logic that:
1. Checks if the completed step has `nextSteps` (DAG mode) or just `order` (linear mode)
2. In DAG mode: evaluate each edge's condition against the completed step's context
3. Take the first matching edge (or the unconditional default)
4. If the target step is a merge point: check if ALL its `prevSteps` are done before activating
5. If the step has `isParallelRoot`: activate all next steps simultaneously
6. If no edges match and step has `fallbackAgentId`: create a retry with the fallback agent

Linear mode (no `nextSteps`) works exactly as before — backward compatible.

- [ ] **Step 2: Add fallback agent handling**

When a step fails and has a `fallbackAgentId`, instead of immediately failing:
1. Create a new execution attempt with the fallback agent
2. Update the step's `agentId` to the fallback
3. Set step back to `active`
4. Let the queue pick it up

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat: DAG-aware chain advancement with conditions, parallel branches, and fallback agents"
```

---

## Task 4: Build visual workflow editor

**Files:**
- Create: `src/components/workflow-editor.tsx`
- Modify: `src/components/chain-builder.tsx`

- [ ] **Step 1: Create workflow editor component**

A visual node-and-edge editor for DAG chains. Each node is a step (agent or human). Edges are connections with optional conditions. Users can:
- Add steps (nodes)
- Connect steps with edges (drag from output port to input port)
- Add conditions to edges (click edge → condition editor popup)
- Mark steps as parallel roots or merge points
- Set fallback agents on steps
- Preview the workflow as a diagram

Use a simple canvas/SVG-based approach — no external graph library needed for the initial version. Steps are positioned in columns by topological order.

- [ ] **Step 2: Integrate with chain builder**

Add a "Visual Editor" toggle to the existing chain builder. The linear step list remains the default; the visual editor is an alternative view for DAG workflows.

- [ ] **Step 3: Commit**

```bash
git add src/components/workflow-editor.tsx src/components/chain-builder.tsx
git commit -m "feat: add visual workflow editor for DAG chain design"
```

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `schema.prisma`, `contracts.ts` | DAG edge fields, merge points, fallback agents |
| 2 | `condition-evaluator.ts` | Condition evaluation engine |
| 3 | `dispatch.ts` | DAG-aware advanceChain with conditions, parallel, merge, fallback |
| 4 | `workflow-editor.tsx`, `chain-builder.tsx` | Visual node-and-edge workflow editor |

**After this, the workflow model is:**
Linear chains still work as before. DAG chains use `nextSteps` edges with conditions. Parallel branches fan out from `isParallelRoot` steps. Merge points wait for all incoming edges to complete. Fallback agents automatically retry failed steps with a different agent. Conditions evaluate step output/status to decide which branch to take.
