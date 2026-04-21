# HTTP-Poll Agent Live Events — Design

**Status:** Design — not yet implemented
**Date:** 2026-04-21
**Related:** `src/app/api/daemon/events/route.ts`, `src/lib/server/daemon-contracts.ts`, `src/components/daemon-log-viewer.tsx`, `src/components/runtime-dashboard.tsx`
**Supersedes:** nothing (new feature)
**Enables:** a future Kanban-side "live activity on in-progress card" feature (cut B in the preceding brainstorm).

## The feature in one sentence

**HTTP-poll agents** (those using `/api/cli` or `/api/agent/*`) emit the same real-time activity events — `thinking`, `tool_call`, `tool_result`, `text`, `completed`, `error` — that daemon-launched agents already emit, so any live-UI feature can subscribe to a single stream regardless of which integration path produced the event.

## Why now

Conductor supports two agent integration modes:
- **Daemon** (`invocationMode: 'DAEMON'`): conductor-daemon pulls a step via `/api/daemon/steps/next`, runs it locally, and streams activity to `/api/daemon/events`. Already wired end-to-end.
- **HTTP-poll** (`invocationMode: 'HTTP'`): agent polls `/api/agent/next` or `/api/cli`, does work out-of-band, reports `claim`/`done`/`note`/`review`. **No live visibility during execution.**

If we ship any Kanban-side "feels alive" UX (pulse indicator, tail panel, live log tab) based on the existing `daemon-agent-event` stream, HTTP-poll agents are invisible on the board during execution. That's the majority of the current dogfood agents (daemon is newer, less commonly deployed). So the UX pitch needs parity across both paths before it's worth building.

## Architecture

Near-symmetric mirror of the existing daemon pipeline.

```
┌─────────────────────────┐
│  Daemon  →  POST        │
│  token      /api/daemon │─┐
│             /events     │ │
└─────────────────────────┘ │
                            │    ┌──────────────────┐      ┌──────────────────┐
                            ├───►│ broadcastProject │─────►│ socket.io        │
                            │    │ Event(           │      │ emit             │
                            │    │   'agent-live-   │      │ 'agent-live-     │
                            │    │   event',        │      │  event'          │
                            │    │   {source,...}   │      │                  │
                            │    │ )                │      └──────────────────┘
                            │    └──────────────────┘              │
                            │                                      ▼
┌─────────────────────────┐ │                             ┌──────────────────┐
│  HTTP agent  →  POST    │ │                             │ page.tsx         │
│  Bearer key     /api/   │─┘                             │ daemonLogs       │
│                 agent/  │                               │ ring buffer      │
│                 events  │                               │ (rename →        │
└─────────────────────────┘                               │  liveAgentLogs)  │
                                                          └──────────────────┘
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │ DaemonLogViewer  │
                                                          │ in Runtime Dash  │
                                                          │ (already works;  │
                                                          │  no component    │
                                                          │  change needed)  │
                                                          └──────────────────┘
```

## Scope

**In scope:**
- One new endpoint: `POST /api/agent/events`.
- One schema rename + alias: `daemonEventSchema` → `liveAgentEventSchema`.
- One socket event rename: `daemon-agent-event` → `agent-live-event`.
- Socket payload adds `source: 'daemon' | 'http'` and `agentId?: string`.
- Client listener (`page.tsx`) updated to the new event name; ring-buffer type widened.
- Tests for the new endpoint.

**Out of scope:**
- UI changes on the Kanban board (that's cut B; separate spec + plan).
- Event retention / persistence.
- Reconnect replay from history.
- Rate limiting beyond body-size cap.
- HTTP-poll agent SDK / helper libraries (agents self-emit via raw `fetch`).
- Backward-compat for external WS consumers (none exist per user confirmation).

## Endpoint

### `POST /api/agent/events`

**Auth:** agent Bearer token via `extractAgentApiKey`. Reject 401 on missing/invalid.

**Request body:**
```typescript
{
  taskId: string       // required
  stepId?: string      // optional — set only when inside a chain step
  event: LiveAgentEvent // discriminated union, see below
}
```

**Validation:**
1. `taskId` resolves to a real task. 404 if not.
2. `task.projectId === agent.projectId`. 403 if not. (HTTP agents are project-scoped, unlike daemon tokens which are workspace-scoped.)
3. `stepId`, if provided, must resolve to a step on that task. 404 if not.
4. `event` passes `liveAgentEventSchema.safeParse`. 400 on shape error.
5. Body size ≤ 5KB (enforced by Next.js; event schema's per-field `.max(5000)` also caps text content).

**Success:** broadcasts to the project room:
```typescript
broadcastProjectEvent(task.projectId, 'agent-live-event', {
  source: 'http',
  agentId: agent.id,
  taskId,
  stepId,
  event: parsed.data,
  timestamp: new Date().toISOString(),
})
```

Returns `{ ok: true }` 200.

**Does not persist.** Broadcast-only, matching the daemon path.

## Schema (`liveAgentEventSchema`)

Move from `src/lib/server/daemon-contracts.ts` to a new location (recommended: keep in `daemon-contracts.ts` to minimize churn; rename only). Exact shape unchanged from today:

```typescript
export const liveAgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking') }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    ok: z.boolean(),
    output: z.string().max(5000),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    chunk: z.string().max(5000),
  }),
  z.object({
    type: z.literal('completed'),
    summary: z.string().max(5000).optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().max(5000),
  }),
])

// Alias for one release cycle; remove after confirming no external consumer.
export const daemonEventSchema = liveAgentEventSchema
```

Both `/api/daemon/events` and `/api/agent/events` import `liveAgentEventSchema` directly.

## Socket event rename

**Before:** `daemon-agent-event` (daemon path only). Payload: `{ taskId, stepId?, daemonId, event, timestamp }`.

**After:** `agent-live-event` (both paths). Payload: `{ source: 'daemon' | 'http', taskId, stepId?, agentId?, daemonId?, event, timestamp }`.

- `source: 'daemon'` sets `daemonId`, omits `agentId`.
- `source: 'http'` sets `agentId`, omits `daemonId`.
- No other fields change.

### Consumer updates

Single in-repo consumer at `src/app/page.tsx:362`:

Before:
```typescript
activeSocket.on('daemon-agent-event', (data: unknown) => {
  const entry = data as typeof daemonLogs[number]
  setDaemonLogs(prev => [...prev, entry].slice(-500))
})
```

After:
```typescript
activeSocket.on('agent-live-event', (data: unknown) => {
  const entry = data as typeof liveAgentLogs[number]
  setLiveAgentLogs(prev => [...prev, entry].slice(-500))
})
```

State variable `daemonLogs` renames to `liveAgentLogs`. Type widens to include `source` + optional `agentId`. The type is declared inline in `page.tsx:240` — update there.

Downstream prop rename: `RuntimeDashboard`'s `daemonLogs: DaemonLogEntry[]` prop becomes `liveAgentLogs: LiveAgentLogEntry[]` (`runtime-dashboard.tsx:51,54`). The filter at `runtime-dashboard.tsx:209` — `l.daemonId === daemon.id` — is left unchanged: HTTP-sourced events have `daemonId: undefined`, so the filter naturally excludes them from the daemon-scoped Runtime Dashboard view (which is what we want; HTTP agents don't own daemons, so they shouldn't appear there).

`DaemonLogViewer` takes an `entries` prop; it doesn't reference `daemonLogs` by name, so no rename inside that component. **Component name stays `DaemonLogViewer`** — renaming it to `LiveAgentLogViewer` is a cosmetic follow-up worth more than its blast radius for v1.

## File plan

**New:**
- `src/app/api/agent/events/route.ts` — POST handler.
- `src/app/api/agent/events/__tests__/route.test.ts` — unit tests (mock `@/lib/db`, assert auth checks, validation, broadcast payload).

**Modified:**
- `src/lib/server/daemon-contracts.ts` — rename `daemonEventSchema` → `liveAgentEventSchema`; add alias re-export; no shape change.
- `src/app/api/daemon/events/route.ts` — switch import to `liveAgentEventSchema`; switch broadcast event to `agent-live-event`; payload gains `source: 'daemon'`, renames `daemonId` to stay as a sibling of the new `agentId?` field.
- `src/app/page.tsx` — listener name + state rename + prop rename (local refactor, 3–4 call sites).
- `src/components/runtime-dashboard.tsx` — prop rename `daemonLogs` → `liveAgentLogs`.
- `src/components/daemon-log-viewer.tsx` — prop passthrough rename if applicable. Component name stays.

## Tests

Unit tests for the new endpoint, `mock.module('@/lib/db', ...)` style consistent with the existing test pattern:

1. 401 when API key missing.
2. 401 when API key invalid.
3. 400 when body fails schema validation (e.g. unknown event type).
4. 404 when `taskId` doesn't exist.
5. 403 when `task.projectId !== agent.projectId`.
6. 404 when `stepId` provided but doesn't belong to that task.
7. On success, `broadcastProjectEvent` is called with:
   - correct project ID,
   - event name `'agent-live-event'`,
   - payload containing `source: 'http'`, `agentId`, `taskId`, `event`, `timestamp`.

No tests for the renames themselves (existing test coverage already exercises daemon-events and would fail if the rename breaks anything).

## Migration notes

- **No schema migration.** No new DB tables, no Prisma changes.
- **No data migration.** Ephemeral feature.
- **No env vars.**
- **Socket event rename:** pre-production only; user confirmed no external WS consumers are deployed. Alias schema export covers any code path that still imports `daemonEventSchema` by name during the transition (can be removed in a future cleanup).

## Questions explicitly resolved by this doc

1. **Endpoint vs `/api/cli` extension:** dedicated `/api/agent/events` endpoint, not a new `/api/cli` action. Cleaner separation; events are structured payloads that don't fit `/api/cli`'s text-oriented surface.
2. **Event schema:** shared with daemon path via rename + alias, not duplicated.
3. **Socket event name:** renamed to `agent-live-event` (neutral), since both sources now contribute. No backward compat kept for external listeners.
4. **Rate limiting:** none beyond body-size cap. Revisit only if a specific agent is observed spamming.
5. **Retention / replay:** none. Matches daemon path.
6. **Persistence:** none. Matches daemon path.
7. **Identity in payload:** `daemonId` for daemon source, `agentId` for HTTP source. Both present on the top-level payload with the other `undefined`.

## Success criteria

1. An HTTP-poll agent with a valid API key can `POST` a `thinking` event to `/api/agent/events` and an open browser session on the same project receives it in the `agent-live-event` socket stream within one round-trip.
2. An invalid API key is rejected with 401.
3. An agent can only emit for tasks in its own project (403 otherwise).
4. Existing daemon-emitted events continue to flow, under the new socket event name, without UI regression.
5. All tests pass: new endpoint suite + existing 111 server-side tests.
