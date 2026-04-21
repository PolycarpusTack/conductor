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
