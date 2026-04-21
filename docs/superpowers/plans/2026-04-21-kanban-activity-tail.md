# Kanban Activity Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable inline activity tail to each IN_PROGRESS Kanban card that renders the last 5 live-agent events for that task (coalescing consecutive `text` chunks) — so the board shows what every running agent is doing at a glance without opening the Runtime Dashboard.

**Architecture:** Three tasks in order. (1) Lift the duplicated `LiveAgentLogEntry` type into a single `src/types/live-agent.ts` so the new component and existing consumers share one source of truth. (2) Build the pure-presentational `ActivityTail` component with the coalescing reducer and per-type row formatter. (3) Mount the component on IN_PROGRESS cards in `page.tsx`, filtering the existing `liveAgentLogs` ring buffer by `task.id` and stopping propagation on the toggle click so drag-and-drop still works.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, bun:test (for server-side tests only — no React component tests per codebase convention).

**Source spec:** `docs/superpowers/specs/2026-04-21-kanban-activity-tail-design.md`.

---

## File Structure

**New files**
- `src/types/live-agent.ts` — single exported `LiveAgentLogEntry` type consumed by page.tsx, runtime-dashboard.tsx, and the new activity-tail.tsx.
- `src/components/activity-tail.tsx` — pure presentational component: toggle, coalescing reducer, per-type formatter.

**Modified files**
- `src/app/page.tsx` — replace the inline `LiveAgentLogEntry` type at line 240 with an import; mount `<ActivityTail>` inside the IN_PROGRESS task card body.
- `src/components/runtime-dashboard.tsx` — replace the inline `LiveAgentLogEntry` interface at lines 30–38 with an import.

**No test files.** The repo's test convention is server-logic-only (`bun:test` under `src/lib/server/__tests__/`). Adding a React testing-library setup for one component is disproportionate. The reducer is a pure function that could be unit-tested; see the "optional follow-up" note in Task 2 Step 3 if you want to extract and cover it.

---

## Task 1: Extract `LiveAgentLogEntry` to a single exported type

**Files:**
- Create: `src/types/live-agent.ts`
- Modify: `src/app/page.tsx` (line ~240)
- Modify: `src/components/runtime-dashboard.tsx` (lines ~30–38)

- [ ] **Step 1: Create the shared type file**

Create `src/types/live-agent.ts`:

```typescript
/**
 * Shape of an entry in the client-side live-agent ring buffer.
 * Emitted by both daemon and HTTP-poll agents via the `agent-live-event`
 * socket broadcast; accumulated in page.tsx and fanned out to consumers
 * (Runtime Dashboard, Kanban activity tail).
 */
export type LiveAgentLogEntry = {
  source: 'daemon' | 'http'
  taskId: string
  stepId?: string
  daemonId?: string
  agentId?: string
  event: {
    type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'
    [key: string]: unknown
  }
  timestamp: string
}
```

- [ ] **Step 2: Update page.tsx to use the shared type**

In `src/app/page.tsx`:

**a.** Add this import with the other type imports at the top of the file (search for other `import type { ... } from ...` lines; place it alphabetically or alongside them):

```typescript
import type { LiveAgentLogEntry } from '@/types/live-agent'
```

**b.** Find the inline state declaration around line 240:

```typescript
const [liveAgentLogs, setLiveAgentLogs] = useState<Array<{ source: 'daemon' | 'http'; taskId: string; stepId?: string; daemonId?: string; agentId?: string; event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }; timestamp: string }>>([])
```

Replace with:

```typescript
const [liveAgentLogs, setLiveAgentLogs] = useState<LiveAgentLogEntry[]>([])
```

**c.** Find the socket listener around line 362:

```typescript
activeSocket.on('agent-live-event', (data: unknown) => {
  const entry = data as typeof liveAgentLogs[number]
  setLiveAgentLogs(prev => [...prev, entry].slice(-500))
})
```

The `typeof liveAgentLogs[number]` cast still resolves correctly after the state-type change (it's inferred from the new `LiveAgentLogEntry[]`), so no edit is needed here. Verify by leaving that listener as-is. If a reviewer prefers the explicit form, change to `data as LiveAgentLogEntry` — both work.

- [ ] **Step 3: Update runtime-dashboard.tsx to use the shared type**

In `src/components/runtime-dashboard.tsx`:

**a.** Add the import near the top, after the React imports:

```typescript
import type { LiveAgentLogEntry } from '@/types/live-agent'
```

**b.** Delete the inline interface at lines ~30–38:

```typescript
interface LiveAgentLogEntry {
  source: 'daemon' | 'http'
  taskId: string
  stepId?: string
  daemonId?: string
  agentId?: string
  event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }
  timestamp: string
}
```

No other code in the file changes — the downstream `RuntimeDashboardProps.liveAgentLogs: LiveAgentLogEntry[]` continues to resolve via the import.

- [ ] **Step 4: Run tests + type-check gate**

Run: `bun test`
Expected: all tests pass (140 from last count). No new or changed tests in this task — the change is type-only and can't affect runtime behavior.

Skip local `tsc` — WSL-local `tsc` misses `.next/types/validator.ts`. The controller will ask the user to run `bun run type-check` from Windows before the branch merges. This task's change is a pure structural rename so the risk of a type regression is minimal, but the Windows check at the end of the branch still closes the gate.

- [ ] **Step 5: Commit**

```bash
git add src/types/live-agent.ts src/app/page.tsx src/components/runtime-dashboard.tsx
git commit -m "refactor(types): lift LiveAgentLogEntry to src/types/live-agent.ts

Single source of truth consumed by page.tsx, runtime-dashboard.tsx,
and (next) activity-tail.tsx. Closes the duplicate-type-drift risk
flagged in the final review of the HTTP events branch."
```

---

## Task 2: Create `ActivityTail` component

**Files:**
- Create: `src/components/activity-tail.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/activity-tail.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

import type { LiveAgentLogEntry } from '@/types/live-agent'

type ActivityTailProps = {
  taskId: string
  events: LiveAgentLogEntry[]
}

/**
 * Inline activity tail for an in-progress Kanban card.
 *
 * Renders a collapsed toggle by default; when expanded, shows the last 5
 * events for this task with consecutive `text` events coalesced into one
 * ticker row. Pure presentation — filtering by taskId happens at the call
 * site.
 */
export function ActivityTail({ taskId, events }: ActivityTailProps) {
  const [expanded, setExpanded] = useState(false)

  // Ignore the `taskId` prop at runtime — it's only there so the component
  // re-keys cleanly when a card's task id changes. (React handles that via
  // the parent's `key` prop in practice; this is defensive documentation.)
  void taskId

  const visible = coalesceAndLimit(events)

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        draggable={false}
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden />
        )}
        <span>activity</span>
        {!expanded && events.length > 0 ? (
          <span className="text-muted-foreground/60">({events.length})</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {visible.length === 0 ? (
            <div className="italic">waiting for activity…</div>
          ) : (
            visible.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="truncate">
                {formatRow(entry)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Fold consecutive `text` events into one synthetic entry whose chunk is
 * the tail-60 of the concatenation. Any non-text event breaks the streak.
 * Returns the last 5 rows after coalescing.
 */
function coalesceAndLimit(events: LiveAgentLogEntry[]): LiveAgentLogEntry[] {
  const out: LiveAgentLogEntry[] = []
  for (const ev of events) {
    const prev = out[out.length - 1]
    if (ev.event.type === 'text' && prev?.event.type === 'text') {
      const prevChunk = typeof prev.event.chunk === 'string' ? prev.event.chunk : ''
      const evChunk = typeof ev.event.chunk === 'string' ? ev.event.chunk : ''
      out[out.length - 1] = {
        ...ev,
        event: { type: 'text', chunk: (prevChunk + evChunk).slice(-60) },
      }
    } else {
      out.push(ev)
    }
  }
  return out.slice(-5)
}

/**
 * Render one row as `<icon> <one-line text>`. Truncation rules: 60 chars
 * from the start for most types, 60 chars from the end for `text` (shows
 * the most recent typed output).
 */
function formatRow(entry: LiveAgentLogEntry): string {
  const { event } = entry
  switch (event.type) {
    case 'thinking':
      return '💭 thinking…'
    case 'tool_call': {
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      return `🔧 ${name}`
    }
    case 'tool_result': {
      const ok = event.ok !== false
      const output = typeof event.output === 'string' ? event.output.slice(0, 60) : ''
      if (ok) return output ? `✅ ${output}` : '✅ ok'
      return output ? `❌ ${output}` : '❌ failed'
    }
    case 'text': {
      const chunk = typeof event.chunk === 'string' ? event.chunk : ''
      return `💬 …${chunk.slice(-60)}`
    }
    case 'completed': {
      const summary = typeof event.summary === 'string' ? event.summary.slice(0, 60) : ''
      return summary ? `🏁 ${summary}` : '🏁 done'
    }
    case 'error': {
      const message = typeof event.message === 'string' ? event.message.slice(0, 60) : ''
      return message ? `⚠️ ${message}` : '⚠️ error'
    }
    default:
      return '•'
  }
}
```

- [ ] **Step 2: Verify it compiles (imports resolve)**

Run: `grep -n "export.*cn\|from '@/types/live-agent'" src/lib/utils.ts src/types/live-agent.ts 2>&1`
Expected: confirms `cn` (unused in this component) and the `LiveAgentLogEntry` type export both exist.

Run: `bun test`
Expected: all tests pass (no behavior change).

Skip local `tsc` per the Task 1 Step 4 note. Controller handles Windows type-check at end of branch.

- [ ] **Step 3: Optional — unit test for the reducer (skip unless you want it)**

The `coalesceAndLimit` and `formatRow` functions are pure and could be unit-tested with a `bun:test` file. The repo has no React testing-library setup, so component-level tests aren't viable, but pure-function tests are cheap.

If you choose to add them, export the two helpers from the component file and write `src/lib/__tests__/activity-tail-reducer.test.ts` with at minimum:
- empty input → empty output
- 3 consecutive text chunks → 1 row whose chunk is the concatenation tail
- tool_call → text → tool_call → preserves the 3-row ordering (no cross-event coalescing)
- 10 events → last 5 returned

If you skip, the reducer's correctness is covered by the "Success criteria" point 4 in the spec during manual smoke testing at the end of the branch.

**Defer by default** — scope discipline. Ask the controller if unsure.

- [ ] **Step 4: Commit**

```bash
git add src/components/activity-tail.tsx
git commit -m "feat(activity-tail): pure-presentational tail component with text coalescing

Click-to-expand toggle shows the last 5 live-agent events for a task,
coalescing consecutive text chunks into a single ticker row. Pure
component — filtering happens at the call site in Task 3."
```

---

## Task 3: Mount `ActivityTail` on IN_PROGRESS cards in page.tsx

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/app/page.tsx`, near the other `@/components/*` imports, add:

```typescript
import { ActivityTail } from '@/components/activity-tail'
```

- [ ] **Step 2: Mount the component on IN_PROGRESS cards**

Locate the Kanban card body in `src/app/page.tsx` around line 2047–2053:

```tsx
                                  {task.notes && (
                                    <div className="mt-2 rounded-md bg-surface/60 px-2 py-1.5">
                                      <p className="text-[10px] leading-snug text-muted-foreground line-clamp-2">{task.notes}</p>
                                    </div>
                                  )}
                                  
                                  <div className="mt-2 flex items-center justify-between">
```

Insert the activity tail between the notes block and the tag/button footer. The full replacement block:

```tsx
                                  {task.notes && (
                                    <div className="mt-2 rounded-md bg-surface/60 px-2 py-1.5">
                                      <p className="text-[10px] leading-snug text-muted-foreground line-clamp-2">{task.notes}</p>
                                    </div>
                                  )}

                                  {task.status === 'IN_PROGRESS' ? (
                                    <ActivityTail
                                      taskId={task.id}
                                      events={liveAgentLogs.filter((l) => l.taskId === task.id)}
                                    />
                                  ) : null}

                                  <div className="mt-2 flex items-center justify-between">
```

The conditional renders the tail only for IN_PROGRESS tasks. The `.filter` runs per render; the dataset is small (≤500 entries) and this is fine.

- [ ] **Step 3: Manual smoke test (browser)**

Start the dev server and verify the UX:

Run: `bun run dev`
Open the board in a browser. You'll need at least one IN_PROGRESS task assigned to an agent that can emit live events. Two shortcuts if you don't have an agent running:

**Option A — curl against the new agent-events endpoint** (requires an agent API key):

```bash
# Get an agent key from Settings → API Keys, then:
AGENT_KEY="..."
AGENT_ID="..."
TASK_ID="..."   # a task currently in IN_PROGRESS for that agent's project

curl -X POST http://localhost:3000/api/agent/events \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TASK_ID\",\"event\":{\"type\":\"tool_call\",\"name\":\"read_file\",\"args\":{\"path\":\"x.ts\"}}}"
```

**Option B — daemon agent running locally.** If a local daemon is already wired, let it drive the events naturally.

Checks:
1. The IN_PROGRESS card shows a `▸ activity` toggle.
2. Clicking the toggle expands the tail. Clicking again collapses it.
3. After curl'ing a `tool_call` event, the tail (when expanded) shows `🔧 read_file` as a single row. The collapsed toggle shows `(1)`.
4. Sending 10 consecutive `text` events with `"chunk":"a"`, `"chunk":"b"`, ... produces one coalesced row like `💬 …abcdefghij`, not 10 rows.
5. Dragging the card to another column still works — the toggle does not intercept the drag.
6. BACKLOG / REVIEW / WAITING / DONE cards show no activity toggle.

If any check fails, fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(activity-tail): mount on IN_PROGRESS Kanban cards

Filters the existing liveAgentLogs ring buffer by task.id and hands
the subset to <ActivityTail>. Toggle's stopPropagation keeps drag-
and-drop intact."
```

---

## Self-Review Checklist (run before handoff)

- [ ] **Spec coverage:**
  - LiveAgentLogEntry consolidation: Task 1.
  - Coalescing reducer: Task 2 Step 1 (`coalesceAndLimit`).
  - Per-type formatter: Task 2 Step 1 (`formatRow`).
  - Click-to-expand toggle: Task 2 Step 1 (the `<button>` + `useState(expanded)`).
  - 5-slot window: Task 2 Step 1 (`out.slice(-5)`).
  - Empty state `waiting for activity…`: Task 2 Step 1.
  - IN_PROGRESS gate: Task 3 Step 2 (`task.status === 'IN_PROGRESS' ? ... : null`).
  - Drag-and-drop safety: Task 2 Step 1 (`e.stopPropagation()` on click + `onPointerDown`).
  - Count badge when collapsed: Task 2 Step 1 (`({events.length})`).
  - Filter happens at call site: Task 3 Step 2 (`liveAgentLogs.filter(...)`).

- [ ] **No placeholders:** every step has literal code or exact commands. No "similar to Task N" or "handle edge cases." The optional-reducer-test step is explicitly labeled optional with a default of "defer."

- [ ] **Type consistency:**
  - `LiveAgentLogEntry` always imported from `@/types/live-agent` (Tasks 1, 2, 3).
  - `ActivityTailProps` has exactly `{ taskId, events }`; Task 3 passes exactly those props.
  - Event type union `'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'` appears identically in Tasks 1 (type) and 2 (switch).

- [ ] **Scope discipline:** no UI component test framework added. No activity tail on non-IN_PROGRESS cards. No toggle-state persistence. No per-event click-through. No scrollback. No timestamp in rows. Out-of-scope items from the spec are honored.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-kanban-activity-tail.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
