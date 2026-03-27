# Conductor v2 — Feature Backlog & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Conductor from MVP to production-ready by closing the gaps in human oversight, MCP integration, step visibility, and adapter coverage.

**Architecture:** Each task is a self-contained, shippable unit. Ordered by priority — earlier tasks unlock more value. Each task produces working, testable software.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui, Socket.IO

---

## Feature Backlog (Prioritized)

| # | Feature | Priority | Effort | Dependencies |
|---|---------|----------|--------|-------------|
| 1 | Human rejection with redo/feedback | High | Medium | None |
| 2 | Step output viewer panel | High | Small | None |
| 3 | Task detail drawer (full chain history) | High | Medium | #2 |
| 4 | Retry/skip/redo UI buttons on task cards | High | Small | #1 |
| 5 | MCP tool integration in dispatch | High | Medium | None |
| 6 | OpenAI dispatch adapter | Medium | Small | None |
| 7 | Agent activity dashboard | Medium | Medium | None |
| 8 | Multi-user auth (JWT + roles) | Medium | Medium | None |
| 9 | Unit tests for core logic | Medium | Medium | None |
| 10 | Mobile responsive board | Low | Small | None |

---

## Task 1: Human Rejection with Redo/Feedback

**Problem:** When a human reviews agent output, they can only approve (advance the chain). No way to reject, provide feedback, and send work back.

**Files:**
- Modify: `prisma/schema.prisma` — add fields to TaskStep
- Modify: `src/lib/server/contracts.ts` — add rejection schema
- Modify: `src/app/api/tasks/[id]/steps/[stepId]/route.ts` — add reject/redo action
- Modify: `src/lib/server/dispatch.ts` — add rewindChain function
- Modify: `src/lib/server/selects.ts` — include new fields in step select

### Schema changes

- [ ] **Step 1: Add rejection fields to TaskStep**

Add to `TaskStep` model in `prisma/schema.prisma`:
```prisma
  rejectionNote  String?
  attempts       Int       @default(0)
```

Run: `bun run db:push --accept-data-loss && bun run db:generate`

- [ ] **Step 2: Add rejection Zod schema**

Add to `src/lib/server/contracts.ts`:
```typescript
export const rejectStepSchema = z.object({
  action: z.literal('reject'),
  target: z.enum(['redo', 'reassign', 'close']),
  note: z.string().min(1).max(5000),
  reassignAgentId: z.string().optional(),
  reassignMode: z.string().optional(),
})
```

- [ ] **Step 3: Update step select to include new fields**

In `src/lib/server/selects.ts`, add to the steps select in `taskBoardInclude`:
```typescript
rejectionNote: true,
attempts: true,
```

- [ ] **Step 4: Add rewindChain to dispatch engine**

Add to `src/lib/server/dispatch.ts`:

```typescript
export async function rewindChain(
  taskId: string,
  projectId: string,
  targetStepId: string,
  rejectionNote: string,
) {
  // Find the step to rewind to
  const targetStep = await db.taskStep.findUnique({
    where: { id: targetStepId },
    include: { agent: true },
  })

  if (!targetStep) throw new Error('Target step not found')

  // Reset the target step to active with rejection context
  await db.taskStep.update({
    where: { id: targetStepId },
    data: {
      status: 'active',
      output: null,
      error: null,
      rejectionNote,
      attempts: { increment: 1 },
      startedAt: null,
      completedAt: null,
    },
  })

  // Reset all steps after the target back to pending
  await db.taskStep.updateMany({
    where: {
      taskId,
      order: { gt: targetStep.order },
    },
    data: {
      status: 'pending',
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
    },
  })

  // Move task back to IN_PROGRESS
  await db.task.update({
    where: { id: taskId },
    data: { status: 'IN_PROGRESS' },
  })

  await broadcastProjectEvent(projectId, 'chain-rewound', {
    taskId,
    targetStepId,
    rejectionNote,
  })

  // If the target step has a runtime agent, dispatch
  if (targetStep.agent?.runtimeId) {
    dispatchStep(targetStepId).catch(console.error)
  }
}

export async function closeChain(taskId: string, projectId: string, note: string) {
  // Mark all pending/active steps as skipped
  await db.taskStep.updateMany({
    where: {
      taskId,
      status: { in: ['pending', 'active'] },
    },
    data: { status: 'skipped' },
  })

  await db.task.update({
    where: { id: taskId },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      output: `Chain closed: ${note}`,
    },
  })

  await broadcastProjectEvent(projectId, 'chain-completed', { taskId, closed: true, note })
}
```

- [ ] **Step 5: Add reject/redo/close actions to step API**

In `src/app/api/tasks/[id]/steps/[stepId]/route.ts`, add to the PUT handler:

```typescript
import { rewindChain, closeChain } from '@/lib/server/dispatch'

// After existing retry/skip handlers, add:

// Handle reject → redo (rewind to a previous agent step)
if (body.action === 'reject' && body.target === 'redo') {
  const note = typeof body.note === 'string' ? body.note : ''
  if (!note) {
    return NextResponse.json({ error: 'Rejection note is required' }, { status: 400 })
  }

  // Find the most recent agent step before this human step
  const previousAgentStep = await db.taskStep.findFirst({
    where: {
      taskId: id,
      order: { lt: existingStep.order },
      mode: { not: 'human' },
    },
    orderBy: { order: 'desc' },
  })

  if (!previousAgentStep) {
    return NextResponse.json({ error: 'No previous agent step to redo' }, { status: 400 })
  }

  // Mark current human step back to pending
  await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'pending', output: null, completedAt: null },
  })

  await rewindChain(id, projectId, previousAgentStep.id, note)
  return NextResponse.json({ success: true, action: 'rewound', targetStepId: previousAgentStep.id })
}

// Handle reject → close (kill the chain)
if (body.action === 'reject' && body.target === 'close') {
  const note = typeof body.note === 'string' ? body.note : 'Rejected by human'
  await closeChain(id, projectId, note)
  return NextResponse.json({ success: true, action: 'closed' })
}
```

- [ ] **Step 6: Inject rejection context into dispatch**

In `src/lib/server/dispatch.ts`, in the `dispatchStep` function, after building `taskContext`, check for rejection note:

```typescript
// After building taskContext, before the try block:
const rejectionContext = step.rejectionNote
  ? `\n\nHUMAN FEEDBACK (from previous attempt):\n${step.rejectionNote}\n\nPlease address this feedback in your response.`
  : ''

// Update taskContext to include rejection feedback:
const fullTaskContext = taskContext + rejectionContext
```

Then use `fullTaskContext` instead of `taskContext` in the adapter dispatch call.

- [ ] **Step 7: Add WebSocket event for chain rewind**

Already handled in Step 4 — `chain-rewound` event is broadcast. Add listener in `page.tsx`:

In the WebSocket listeners section, add:
```typescript
activeSocket.on('chain-rewound', () => {
  if (currentProject) fetchProject(currentProject.id).then(setCurrentProject)
})
```

- [ ] **Step 8: Push schema + regenerate + commit**

```bash
bun run db:push --accept-data-loss && bun run db:generate
git add -A
git commit -m "feat: add human rejection with redo/feedback, chain rewind, chain close"
```

---

## Task 2: Step Output Viewer Panel

**Problem:** Step outputs are stored but never shown. Users can't see what each agent produced.

**Files:**
- Create: `src/components/step-output-viewer.tsx`
- Modify: `src/app/page.tsx` — add viewer trigger on task cards

- [ ] **Step 1: Create step output viewer component**

A slide-out panel or expandable section showing all steps for a task with their outputs. Each step shows: number, mode badge, agent name, status, output text (or error), rejection note if any, attempt count.

```typescript
interface StepOutputViewerProps {
  taskId: string
  steps: TaskStep[]
  onClose: () => void
}
```

- [ ] **Step 2: Add expand button to task cards**

On task cards that have steps, add a small "view chain" button (eye icon) that opens the step output viewer.

- [ ] **Step 3: Fetch full step data when viewer opens**

Call `GET /api/tasks/[id]/steps` to get step details including outputs and errors (the board include only has summary fields).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add step output viewer panel for chain visibility"
```

---

## Task 3: Task Detail Drawer

**Problem:** No way to see full task details, chain history, or interact with chain controls in a focused view.

**Files:**
- Create: `src/components/task-detail-drawer.tsx`
- Modify: `src/app/page.tsx` — wire drawer to task card clicks

- [ ] **Step 1: Create task detail drawer component**

A right-side drawer that opens when clicking a task card. Shows:
- Task title, description, priority, tag, status
- Agent assignment
- Full chain timeline with step outputs (reuse step-output-viewer)
- Action buttons at the active step (approve/reject/retry/skip)
- Activity log for this task

- [ ] **Step 2: Wire drawer to task card clicks**

Clicking a task card opens the drawer instead of the edit dialog. Edit moves to a button inside the drawer.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add task detail drawer with chain timeline and action buttons"
```

---

## Task 4: Retry/Skip/Reject UI Buttons

**Problem:** Backend supports retry, skip, redo, and close — but no frontend buttons exist.

**Files:**
- Modify: `src/components/task-detail-drawer.tsx` (or step-output-viewer)
- Modify: `src/app/page.tsx` — add action handlers

- [ ] **Step 1: Add action buttons to active/failed steps**

In the task detail drawer, at the active step:
- If step is `active` and mode is `human`: Show **[Approve] [Reject → Redo] [Close Task]**
- If step is `failed`: Show **[Retry] [Skip] [Close Task]**
- Reject opens a textarea for the rejection note before submitting

- [ ] **Step 2: Wire buttons to API calls**

Each button calls `PUT /api/tasks/[id]/steps/[stepId]` with the appropriate action:
- Approve: `{ action: 'complete', status: 'done' }` (then chain advances)
- Reject → Redo: `{ action: 'reject', target: 'redo', note: '...' }`
- Close: `{ action: 'reject', target: 'close', note: '...' }`
- Retry: `{ action: 'retry' }`
- Skip: `{ action: 'skip' }`

- [ ] **Step 3: Update board after actions**

After any action, refetch the project to update the board state.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add retry/skip/reject UI buttons for chain step control"
```

---

## Task 5: MCP Tool Integration in Dispatch

**Problem:** MCP connections are stored as metadata but the dispatch engine doesn't pass tools to the AI providers.

**Files:**
- Modify: `src/lib/server/dispatch.ts` — resolve MCP connections and pass as tools
- Modify: `src/lib/server/adapters/types.ts` — add tools to DispatchParams
- Modify: `src/lib/server/adapters/anthropic.ts` — pass tools to API call
- Modify: `src/lib/server/adapters/zai.ts` — pass tools if supported

- [ ] **Step 1: Extend DispatchParams with tools**

In `src/lib/server/adapters/types.ts`:
```typescript
export interface McpTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface DispatchParams {
  // ... existing fields
  tools?: McpTool[]
}
```

- [ ] **Step 2: Resolve MCP connections in dispatch engine**

In `dispatchStep`, after building the prompt, resolve the agent's MCP connections:
```typescript
const mcpConnectionIds = agent.mcpConnectionIds
  ? JSON.parse(agent.mcpConnectionIds)
  : []

const mcpConnections = mcpConnectionIds.length > 0
  ? await db.projectMcpConnection.findMany({
      where: { id: { in: mcpConnectionIds } },
    })
  : []

// For each MCP connection, fetch available tools from the MCP server
const tools = await resolveMcpTools(mcpConnections, step.mode)
```

- [ ] **Step 3: Create MCP tool resolver**

Create `src/lib/server/mcp-resolver.ts`:
- Calls each MCP server's `/tools` endpoint
- Filters tools based on the step mode (read-only modes get read-only tools)
- Returns a flat list of tool definitions

- [ ] **Step 4: Pass tools to Anthropic adapter**

In the Anthropic adapter, if `params.tools` is provided, include them in the API call:
```typescript
body: JSON.stringify({
  model: params.model,
  system: params.systemPrompt,
  messages: [...],
  ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
})
```

Handle tool use responses: if the response includes `tool_use` blocks, execute the tool calls against the MCP server and continue the conversation.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: integrate MCP tools into dispatch engine"
```

---

## Task 6: OpenAI Dispatch Adapter

**Problem:** OpenAI is listed as "coming soon" but model discovery already works. Just need the dispatch adapter.

**Files:**
- Create: `src/lib/server/adapters/openai.ts`
- Modify: `src/lib/server/adapters/registry.ts` — register adapter

- [ ] **Step 1: Create OpenAI adapter**

Same pattern as Z.ai adapter (both OpenAI-compatible), but with base URL `https://api.openai.com/v1/chat/completions`.

- [ ] **Step 2: Register in adapter registry**

Replace `unavailableAdapter('openai', 'OpenAI')` with `openaiAdapter`.

- [ ] **Step 3: Remove disabled flag from frontend**

In `settings-runtimes.tsx`, OpenAI is already enabled (done earlier).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add OpenAI dispatch adapter"
```

---

## Task 7: Agent Activity Dashboard

**Problem:** No visibility into agent performance metrics (tasks completed, avg time, success rate).

**Files:**
- Create: `src/components/agent-activity-dashboard.tsx`
- Create: `src/app/api/agents/[id]/stats/route.ts`
- Modify: `src/app/page.tsx` — add dashboard to settings or agent detail

- [ ] **Step 1: Create stats API endpoint**

Query ActivityLog and TaskStep for an agent to compute:
- Tasks completed (last 7d, 30d, all time)
- Average step duration
- Success rate (done vs failed steps)
- Most used modes

- [ ] **Step 2: Create dashboard component**

Metric cards showing the stats. Simple, no charts needed for v1.

- [ ] **Step 3: Wire into agent detail or settings**

Add a "Stats" section to the agent detail view or settings agents tab.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add agent activity stats API and dashboard"
```

---

## Task 8: Multi-User Auth (JWT + Roles)

**Problem:** Currently single admin password. Teams need multiple users with different roles.

**Files:**
- Modify: `prisma/schema.prisma` — add User model
- Create: `src/lib/server/jwt.ts` — JWT sign/verify
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/register/route.ts`
- Modify: `src/lib/server/admin-session.ts` — migrate to JWT

- [ ] **Step 1: Add User model**

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // bcrypt hash
  name      String
  role      String   @default("member") // admin, member, viewer
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Implement JWT auth**
- [ ] **Step 3: Create login/register endpoints**
- [ ] **Step 4: Migrate admin session to JWT**
- [ ] **Step 5: Add role-based access control**
- [ ] **Step 6: Commit**

---

## Task 9: Unit Tests for Core Logic

**Problem:** Zero test coverage on critical dispatch and chain logic.

**Files:**
- Create: `src/lib/server/__tests__/resolve-prompt.test.ts`
- Create: `src/lib/server/__tests__/dispatch.test.ts`

- [ ] **Step 1: Test resolvePrompt**

Test all placeholder variables, unknown placeholders left as-is, null handling.

- [ ] **Step 2: Test advanceChain logic**

Mock DB calls, test: auto-continue, human pause, chain complete, failed step halt.

- [ ] **Step 3: Test rewindChain logic**

Test: rejection resets correct steps, injects feedback, re-dispatches.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add unit tests for prompt resolver, dispatch engine, chain advancement"
```

---

## Task 10: Mobile Responsive Board

**Problem:** 5-column board doesn't work on small screens.

**Files:**
- Modify: `src/app/page.tsx` — responsive board layout

- [ ] **Step 1: Add horizontal scroll on mobile**

On screens < 768px, board becomes horizontally scrollable with fixed column widths.

- [ ] **Step 2: Collapse to tab view on very small screens**

On screens < 480px, columns become tabs — tap to switch between Backlog, In Progress, Waiting, Review, Done.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: responsive board layout for mobile"
```

---

## Execution Order

```
Task 1 (rejection/redo) ─────► Task 4 (UI buttons) ─► Task 3 (detail drawer)
Task 2 (step output viewer) ──► Task 3 (detail drawer)
Task 5 (MCP integration) ────► standalone
Task 6 (OpenAI adapter) ─────► standalone
Task 7 (agent dashboard) ────► standalone
Task 8 (multi-user auth) ────► standalone
Task 9 (unit tests) ─────────► standalone
Task 10 (mobile) ────────────► standalone
```

**Recommended sprint order:**
1. Tasks 1 + 2 in parallel (rejection backend + step viewer)
2. Tasks 4 + 3 sequentially (UI buttons → detail drawer)
3. Tasks 5 + 6 in parallel (MCP + OpenAI)
4. Tasks 7-10 as capacity allows
