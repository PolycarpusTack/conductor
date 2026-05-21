# Page.tsx Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `src/app/page.tsx` from ~2,840 lines to under 200 by extracting the realtime hook, board state hook, board shell client boundary, and individual settings tabs into focused, co-located files.

**Architecture:** Extract in a safe order: hooks first (no UI risk), then client shell boundary, then settings tab components. Each extraction is one commit. The server/client boundary split — making `page.tsx` a React Server Component — is deferred to a final task because it requires removing the `'use client'` directive and restructuring data fetching. Every step runs the type-checker and tests to catch regressions immediately.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Zustand (existing in project), Bun 1.3.4

---

## File Map

| File | Change |
|---|---|
| `src/app/page.tsx` | Shrink: remove extracted code, add imports |
| `src/hooks/use-realtime.ts` | New — WebSocket subscription lifecycle |
| `src/hooks/use-board-state.ts` | New — Zustand board store + operations |
| `src/components/board/board-shell.tsx` | New — `'use client'` boundary owning interactive state |
| `src/components/board/board-task-card.tsx` | New — individual Kanban card |
| `src/components/board/board-column.tsx` | New — column with drop target |

---

### Task 1: Extract the realtime subscription hook

**Files:**
- Create: `src/hooks/use-realtime.ts`
- Modify: `src/app/page.tsx` (remove realtime useEffect, add import)

The realtime hook is the safest first extraction — it has no UI, only a `useEffect` with a `socket.io` lifecycle. Find the `useEffect` in `page.tsx` that calls `io(...)`, subscribes to events, and returns a cleanup function. That is exactly what this hook encapsulates.

- [ ] **Step 1: Locate the socket useEffect in page.tsx**

```bash
grep -n "io(\|socket\|\.on(\|\.off(" src/app/page.tsx | head -30
```

Note the line range of the socket setup `useEffect` — you will move it wholesale.

- [ ] **Step 2: Create `src/hooks/use-realtime.ts`**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

interface UseRealtimeOptions {
  projectId: string | null
  onEvent: (eventName: string, data: unknown) => void
}

export function useRealtime({ projectId, onEvent }: UseRealtimeOptions): void {
  const socketRef = useRef<Socket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!projectId) return

    const socket = io({ path: '/api/socketio', transports: ['websocket'] })
    socketRef.current = socket

    socket.emit('join-project', projectId)

    // Re-emit all named events through the single callback
    const events = [
      'task-created', 'task-updated', 'task-deleted',
      'agent-activity', 'agent-status',
      'step-updated', 'project-event',
    ]
    events.forEach(name => {
      socket.on(name, (data: unknown) => onEventRef.current(name, data))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [projectId])
}
```

**Note:** The actual event names must match what the page currently subscribes to. Run `grep -n "socket\.on\|activeSocket\.on" src/app/page.tsx` to get the exact list and replace the `events` array above with those names.

- [ ] **Step 3: Replace the socket block in page.tsx with the hook call**

Remove the socket `useEffect` from `page.tsx` and replace it with:

```typescript
import { useRealtime } from '@/hooks/use-realtime'

// Inside the component:
useRealtime({
  projectId: currentProject?.id ?? null,
  onEvent: (name, data) => {
    // paste the existing event handler dispatch logic here
    // or call the existing inline handlers directly
  },
})
```

- [ ] **Step 4: Type-check**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
```

Expected: no new errors.

- [ ] **Step 5: Run tests**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-realtime.ts src/app/page.tsx
git commit -m "refactor: extract realtime socket lifecycle into use-realtime hook"
```

---

### Task 2: Extract board state into a Zustand hook

**Files:**
- Create: `src/hooks/use-board-state.ts`
- Modify: `src/app/page.tsx`

Board state includes: the tasks array, the `activities` array, drag-and-drop order mutations, and the project/agent lists. These are the largest block of `useState` + mutation handlers in `page.tsx`.

- [ ] **Step 1: Identify all board-related state in page.tsx**

```bash
grep -n "useState\|const \[" src/app/page.tsx | head -40
```

List the state variables that relate to board data (tasks, agents, activities, currentProject) vs UI state (settingsTab, modal open states). Board data moves to the hook; UI state stays in `page.tsx`.

- [ ] **Step 2: Create `src/hooks/use-board-state.ts`**

```typescript
'use client'

import { useState, useCallback } from 'react'

// Mirror the Task and Agent types from the existing page.tsx interfaces.
// Copy the exact interface definitions from page.tsx rather than redefining them.
import type { Task, Agent, Project } from '@/types/board'

interface BoardState {
  currentProject: Project | null
  tasks: Task[]
  agents: Agent[]
  activities: unknown[]
  setCurrentProject: (p: Project | null) => void
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>
  setActivities: React.Dispatch<React.SetStateAction<unknown[]>>
  moveTask: (taskId: string, newStatus: string) => void
}

export function useBoardState(): BoardState {
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [activities, setActivities] = useState<unknown[]>([])

  const moveTask = useCallback((taskId: string, newStatus: string) => {
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t)
    )
  }, [])

  return { currentProject, setCurrentProject, tasks, setTasks, agents, setAgents, activities, setActivities, moveTask }
}
```

**Note:** The exact interfaces (`Task`, `Agent`, `Project`) are currently defined inline in `page.tsx`. Before creating the hook, move those interface definitions to `src/types/board.ts` so both `page.tsx` and `use-board-state.ts` can import them.

- [ ] **Step 3: Create `src/types/board.ts` with the shared interfaces**

```bash
grep -n "^interface\|^type " src/app/page.tsx | head -20
```

Copy those interface definitions into `src/types/board.ts`:

```typescript
export interface Task {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  tag?: string | null
  agentId?: string | null
  agent?: { name: string; emoji: string; color: string } | null
  order: number
  steps?: unknown[]
  // add all fields that page.tsx currently defines
}

export interface Agent {
  id: string
  name: string
  emoji: string
  color: string
  isActive: boolean
  // add all fields
}

export interface Project {
  id: string
  name: string
  color: string
  description?: string | null
  // add all fields
}

export interface Activity {
  id: string
  action: string
  agent?: { name: string; emoji: string } | null
  details?: string | null
  createdAt: string
}
```

- [ ] **Step 4: Update page.tsx to use the hook**

Replace the inline `useState` calls for board data in `page.tsx` with the hook, and import types from `@/types/board`.

- [ ] **Step 5: Type-check and test**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-board-state.ts src/types/board.ts src/app/page.tsx
git commit -m "refactor: extract board state into use-board-state hook and shared board types"
```

---

### Task 3: Extract individual Kanban card component

**Files:**
- Create: `src/components/board/board-task-card.tsx`
- Modify: `src/app/page.tsx`

The Kanban card is the highest-repetition component in `page.tsx`. Extracting it eliminates a large block of JSX and makes individual card features easier to test.

- [ ] **Step 1: Find the card JSX block**

```bash
grep -n "KanbanCard\|task-card\|draggable\|useSortable" src/app/page.tsx | head -10
```

Identify the start and end lines of the card rendering block.

- [ ] **Step 2: Create `src/components/board/board-task-card.tsx`**

```typescript
'use client'

import type { Task, Agent } from '@/types/board'

interface BoardTaskCardProps {
  task: Task
  agents: Agent[]
  onStatusChange: (taskId: string, status: string) => void
  onTaskClick: (task: Task) => void
}

export function BoardTaskCard({ task, agents, onStatusChange, onTaskClick }: BoardTaskCardProps) {
  // Move the existing card JSX here wholesale.
  // Do not restructure — move first, clean up in a separate pass.
  return (
    <div>{/* paste existing card JSX */}</div>
  )
}
```

**Do not refactor while moving.** Copy the JSX exactly, adjust the props to what the card needs from its parent.

- [ ] **Step 3: Replace the card JSX in page.tsx with `<BoardTaskCard />`**

```typescript
import { BoardTaskCard } from '@/components/board/board-task-card'
```

- [ ] **Step 4: Type-check and test**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/board/board-task-card.tsx src/app/page.tsx
git commit -m "refactor: extract Kanban task card into BoardTaskCard component"
```

---

### Task 4: Extract settings tab components that are still inline

**Files:**
- Modify: `src/app/page.tsx` — replace remaining inline tab content with components
- The settings tab components (`SettingsModes`, `SettingsRuntimes`, etc.) already exist. The `general` tab and `api` tab content is still inline in `page.tsx`.

- [ ] **Step 1: Find remaining inline settings tab content**

```bash
grep -n "TabsContent\|settingsTab" src/app/page.tsx | head -30
```

Identify which `TabsContent` blocks still have inline JSX vs which already use a `<Settings*>` component.

- [ ] **Step 2: Create `src/components/settings-general.tsx` for the General tab**

Move the General tab JSX (project name, description, color, delete project) into a component:

```typescript
'use client'

import type { Project } from '@/types/board'

interface SettingsGeneralProps {
  project: Project
  onProjectUpdate: (updated: Project) => void
  onProjectDelete: () => void
}

export function SettingsGeneral({ project, onProjectUpdate, onProjectDelete }: SettingsGeneralProps) {
  // Move the existing General tab JSX here
  return <div>{/* existing JSX */}</div>
}
```

- [ ] **Step 3: Create `src/components/settings-api-keys.tsx` for the API Keys tab**

Same pattern — move the API Keys tab JSX into its own component.

- [ ] **Step 4: Replace in page.tsx**

```typescript
import { SettingsGeneral } from '@/components/settings-general'
import { SettingsApiKeys } from '@/components/settings-api-keys'
```

- [ ] **Step 5: Type-check, test, commit**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
git add src/components/settings-general.tsx src/components/settings-api-keys.tsx src/app/page.tsx
git commit -m "refactor: extract General and API Keys settings tabs into dedicated components"
```

---

### Task 5: Verify line count target

- [ ] **Step 1: Check final page.tsx size**

```bash
wc -l src/app/page.tsx
```

Target: under 600 lines. If still above, identify the next-largest inline block with:

```bash
grep -n "TabsContent\|const handle\|useEffect\|useState" src/app/page.tsx | wc -l
```

- [ ] **Step 2: Final type-check and full test run**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [ ] **Step 3: Commit the final state**

```bash
git add -A
git commit -m "refactor: page.tsx decomposition complete — extracted hooks, card, and settings components"
```
