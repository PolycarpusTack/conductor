# Kanban Activity Tail — Design

**Status:** Design — not yet implemented
**Date:** 2026-04-21
**Related:**
- `docs/superpowers/specs/2026-04-21-http-agent-live-events-design.md` (pipeline prerequisite, now merged)
- `src/app/page.tsx` (Kanban card and `liveAgentLogs` ring buffer)
- `src/components/runtime-dashboard.tsx` (full-log view, unchanged by this spec)

## The feature in one sentence

On each IN_PROGRESS Kanban card, a click-to-expand inline tail renders the last 5 live activity events for that task — drawn from the existing `liveAgentLogs` ring buffer — so the board shows what every running agent is doing at a glance without navigating to the Runtime Dashboard.

## Why now

The HTTP-poll events pipeline (`agent-live-event` socket stream) now carries events from both daemon and HTTP-poll agents. The stream already reaches `src/app/page.tsx` and accumulates in `liveAgentLogs` (500-entry ring buffer). Today it's only rendered in the Runtime Dashboard, which requires a navigation away from the Kanban board — the primary UX surface. The Runtime Dashboard view is correct for a deep dive but wrong for the "is this agent doing anything useful right now?" glance that the board is built for.

This feature adds the missing glance affordance. No new pipeline work — pure UI layered on the existing stream.

## Architecture

One new pure-presentational component. One set of edits to `page.tsx`. No new state at the page level, no new socket listeners, no new schema, no new persistence.

```
src/app/page.tsx (already has liveAgentLogs state from Task 2 of HTTP events)
  │
  ├── for each task on the board, where task.status === 'IN_PROGRESS':
  │     │
  │     └── <ActivityTail
  │           taskId={task.id}
  │           events={liveAgentLogs.filter(l => l.taskId === task.id)}
  │         />
  │
  └── (rest of existing card body unchanged)
```

The component owns the `expanded` boolean as local state. Filtering happens at the call site (trivial `.filter(...)`).

## Component: `ActivityTail`

**File:** `src/components/activity-tail.tsx` (new, ~80 lines).

**Props:**
```typescript
type ActivityTailProps = {
  taskId: string
  events: LiveAgentLogEntry[]
}
```

`LiveAgentLogEntry` is the shape declared inline in `src/app/page.tsx:240` and as a named interface in `src/components/runtime-dashboard.tsx:30`. Both are equivalent today. **During the implementation of this spec, lift `LiveAgentLogEntry` to a single exported type** and import it in all three consumers (page.tsx, runtime-dashboard.tsx, activity-tail.tsx). This resolves Important issue I1 from the final review of the HTTP events branch.

**Behavior:**
- Renders a single clickable toggle by default (collapsed state). Label: `▸ activity` with a subtle count badge when `events.length > 0` (e.g., `▸ activity (3)`).
- When expanded: toggle flips to `▾ activity`, a 5-row list renders beneath it.
- Empty-state: when `events.length === 0`, the expanded view shows a single muted line `waiting for activity…`.
- Collapsed is the default; state is local to the component and not persisted across page reloads.

**Sizing and styling:**
- Uses existing Tailwind tokens consistent with the surrounding card (`text-[10px]` or `text-[11px]`, `font-mono`, `text-muted-foreground`).
- Rows are tight — one line each, truncating via `overflow-hidden text-ellipsis` when content exceeds card width.
- No scroll container. 5 rows fit in ~60px of card height. If the tail would push the card past a comfortable footprint, that's acceptable — IN_PROGRESS cards were short before; now they're a few lines taller when expanded.

## Event coalescing reducer

Raw events can include high-frequency `text` chunks during LLM streaming. Five consecutive `text` chunks would fill the entire 5-slot window and push out earlier tool-call context. The coalescing reducer prevents that.

**Algorithm:**
1. Take `events`, sort by `timestamp` ascending (oldest first). The ring buffer is already in arrival order, so this is effectively a no-op but belt-and-braces.
2. Fold left with an accumulator that tracks the last emitted row's type. When processing a `text` event:
   - If the previous row in the accumulator is also `text`, **replace** it with a new synthetic row whose `chunk` is the concatenation of all consecutive text chunks' payloads, trimmed to the tail 60 characters.
   - Otherwise, push a new `text` row.
3. All other event types always push a new row (breaking any active text streak).
4. After the fold, take the last 5 entries.

**Pseudo-code:**
```typescript
function coalesceTextEvents(events: LiveAgentLogEntry[]): LiveAgentLogEntry[] {
  const out: LiveAgentLogEntry[] = []
  for (const ev of events) {
    const prev = out[out.length - 1]
    if (ev.event.type === 'text' && prev?.event.type === 'text') {
      const mergedChunk = (prev.event.chunk + ev.event.chunk).slice(-60)
      out[out.length - 1] = { ...ev, event: { type: 'text', chunk: mergedChunk } }
    } else {
      out.push(ev)
    }
  }
  return out.slice(-5)
}
```

The reducer runs on every render with the filtered events array; because `liveAgentLogs` is capped at 500 and typical per-task event counts are small, performance is a non-concern.

## Per-type row formatting

Each row is `<icon> <one-line text>`. The formatter is a pure function keyed on `event.type`.

| Type | Rendered row | Notes |
|---|---|---|
| `thinking` | `💭 thinking…` | no payload |
| `tool_call` | `🔧 <name>` | args deliberately omitted to keep rows short; Runtime Dashboard shows them |
| `tool_result` (ok) | `✅ <output first 60 chars>` | falls back to `✅ ok` if output empty |
| `tool_result` (!ok) | `❌ <output first 60 chars>` | falls back to `❌ failed` |
| `text` (coalesced) | `💬 …<tail 60 chars of concatenated chunks>` | leading ellipsis signals this is a tail |
| `completed` | `🏁 <summary first 60 chars>` | falls back to `🏁 done` if no summary |
| `error` | `⚠️ <message first 60 chars>` | always has a message per schema |

Trim rule: `.slice(0, 60)` for all non-text types. `text` uses `.slice(-60)` to show the most recent typed output.

## Data flow

1. Socket delivers `agent-live-event` → `liveAgentLogs` ring buffer (already built in the HTTP events branch).
2. `page.tsx` renders each task card. For IN_PROGRESS cards, it computes `events = liveAgentLogs.filter(l => l.taskId === task.id)` and passes to `<ActivityTail>`.
3. `ActivityTail` owns `expanded` boolean via `useState(false)`.
4. When expanded, `ActivityTail` runs the coalescing reducer on `events`, takes the last 5, and maps each to a row via the formatter.
5. New events arriving via the socket update `liveAgentLogs` in the parent, re-renders the filtered subset, and the tail updates in place.

No memoization is added in v1. If render profiling ever shows it's needed, a `useMemo` on the filter + reducer is a one-line addition. Kanban boards typically carry a handful of in-flight tasks; 5 × N re-computation per tick is negligible.

## Status gating

The toggle and tail render **only when `task.status === 'IN_PROGRESS'`**. Other statuses:
- `BACKLOG`: no toggle. No activity.
- `WAITING`, `REVIEW`: no toggle. Activity may be frozen (events still in buffer) but surfacing it here is out of scope — user can still see frozen events in Runtime Dashboard.
- `DONE`: no toggle. Out of scope. If a user wants a post-mortem, the Runtime Dashboard shows the whole log.

The gate is a simple conditional in `page.tsx`; no prop or branch inside `ActivityTail` handles status.

## Interaction with existing UI

- **Existing `Eye` icon on the card** (opens the task-steps viewer dialog) is unchanged. It shows chain/step structure — a different concern from live activity. Both can coexist. No layout conflict: the Eye button is at the top-right; the activity toggle sits at the bottom of the card body, above the tag/priority footer.
- **Drag-and-drop:** the toggle button must not trigger drag. Use a `stopPropagation` on the toggle's click handler if the surrounding card registers drag events. Study the existing Kanban card event wiring in `page.tsx` during implementation to confirm the pattern.
- **Mobile:** no special handling. The toggle is a small tap target; the expanded tail may push the card taller. If that's awkward on mobile, revisit in a follow-up.

## LiveAgentLogEntry type consolidation

**Action:** During Task 1 of implementation, lift the inline type definitions in `src/app/page.tsx:240` and `src/components/runtime-dashboard.tsx:30` into a single exported type.

**Target file:** `src/types/live-agent.ts` (new). `src/types/` already exists (`socket.io.d.ts` lives there) and is the established home for cross-module client-visible types — no new directory needed.

**Shape:**
```typescript
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

All three consumers (page.tsx, runtime-dashboard.tsx, activity-tail.tsx) import from this one location. This closes the duplicate-type-drift risk flagged in the final review of the HTTP events branch.

## Out of scope

- **Activity tail on non-IN_PROGRESS cards.** Trivial gate to change later.
- **Toggle persistence across reloads.** Would need localStorage keyed by taskId. v1.1 add-on.
- **Scrollback / history beyond the 5-slot window.** That's cut C (full log tab in drawer).
- **Per-event click-through to Runtime Dashboard.** Low-cost add later; not needed for the "feels alive" glance.
- **Per-event timestamp display.** Shown in Runtime Dashboard; omit here to keep rows short.
- **Auto-scroll.** Fixed 5-slot window doesn't scroll.
- **Custom styling per event type beyond the emoji icon.** Colored badges, backgrounds, or hover cards are deferred.
- **React component unit tests.** Repo has no testing-library setup; adding one for this single component is disproportionate scope. Flag in the plan's "follow-up" section if we want one.
- **Storybook / visual regression tests.** Not applicable to this codebase.

## Success criteria

1. An IN_PROGRESS card with no events shows a collapsed toggle; expanding reveals `waiting for activity…`.
2. When a daemon agent emits a `tool_call` event for a task, the corresponding IN_PROGRESS card's toggle shows a `(1)` badge when collapsed; expanding shows `🔧 <toolName>` as the single row.
3. When an HTTP-poll agent emits a `tool_call` event via `POST /api/agent/events`, the card updates identically — no visual distinction between sources.
4. When 10 `text` events arrive consecutively, the tail shows a single `💬 …<last chunk content>` row (not 5 copies of text chunks), and the 4 rows before it are preserved.
5. When the tail already shows 5 events and a 6th arrives, the oldest row falls off and the new row appears at the bottom.
6. Cards in BACKLOG / WAITING / REVIEW / DONE show no activity toggle.
7. Drag-and-drop on a card still works when the tail is expanded; clicking the toggle doesn't start a drag.
8. All 140 server tests still pass after the change (no test regressions).

## Risks and mitigations

- **Vertical bloat on busy boards.** If many tasks are IN_PROGRESS and a user expands several tails, the board gets tall. Mitigation: default-collapsed; power users can collapse any they're not watching. If it becomes a real complaint, add a board-wide "collapse all tails" toggle as follow-up.
- **Ring buffer eviction.** With 500 global events, a fast-emitting sibling task can push older events out before a user expands a slower task's tail. Mitigation accepted: users who care about full history use Runtime Dashboard. Worst case the tail shows "waiting for activity…" when history has been evicted — honest.
- **Re-renders on high event rate.** An LLM streaming 20 text chunks/sec triggers 20 page-level re-renders. The coalescing reducer masks the visual churn, but React will still re-compute filtered arrays for every card. Mitigation: if profiling shows cost, memoize the filter per card. Premature now.
