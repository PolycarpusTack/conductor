'use client'

import { memo, useState } from 'react'
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
 *
 * E-5: `memo`-wrapped. The call site (`CardActivityTail` in board-task-card)
 * keeps the `events` array referentially stable while this task's slice is
 * unchanged, so an `agent-live-event` for a *different* task re-renders that
 * card's subscriber but bails here — only the tail whose task got the event
 * actually re-renders. `taskId` is a string and stable per card.
 */
export const ActivityTail = memo(function ActivityTail({ taskId, events }: ActivityTailProps) {
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
          // Raw event count; expanded view shows fewer rows when text chunks coalesce.
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
}, areEqual)

/**
 * E-5 memo comparator. The live-log array only appends (and front-drops past
 * 500), so each `LiveAgentLogEntry` keeps its identity — an element-wise
 * reference check tells a real change to *this* task's slice apart from a
 * fresh-but-equal array produced by an event for a different task. `taskId` is
 * a stable string per card. Returning true here means "props equal → skip".
 */
function areEqual(prev: ActivityTailProps, next: ActivityTailProps): boolean {
  if (prev.taskId !== next.taskId) return false
  const a = prev.events
  const b = next.events
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
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
