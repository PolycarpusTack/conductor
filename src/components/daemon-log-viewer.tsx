'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Square, ChevronDown } from 'lucide-react'

interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'
  name?: string
  args?: unknown
  ok?: boolean
  output?: string
  chunk?: string
  summary?: string
  message?: string
  truncated?: boolean
}

interface DaemonLogEntry {
  taskId: string
  stepId?: string
  daemonId: string
  event: AgentEvent
  timestamp: string
}

interface DaemonLogViewerProps {
  taskId: string
  entries: DaemonLogEntry[]
  isRunning: boolean
  onKill?: () => void
}

function EventBadge({ type }: { type: AgentEvent['type'] }) {
  const variants: Record<string, { label: string; className: string }> = {
    thinking: { label: 'thinking', className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
    tool_call: { label: 'tool', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
    tool_result: { label: 'result', className: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30' },
    text: { label: 'output', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
    completed: { label: 'done', className: 'bg-green-500/15 text-green-600 border-green-500/30' },
    error: { label: 'error', className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  }

  const v = variants[type] || variants.text
  return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${v.className}`}>{v.label}</Badge>
}

function EventContent({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case 'thinking':
      return <span className="text-yellow-600 italic">Thinking...</span>
    case 'tool_call':
      return (
        <span>
          <span className="text-blue-500 font-medium">{event.name}</span>
          {event.args != null && (
            <span className="text-muted-foreground text-xs ml-1">
              ({typeof event.args === 'string' ? event.args : JSON.stringify(event.args).slice(0, 120)})
            </span>
          )}
        </span>
      )
    case 'tool_result':
      return (
        <span className={event.ok ? 'text-cyan-600' : 'text-red-500'}>
          {(event.output || '').slice(0, 200)}
          {event.truncated && <span className="text-muted-foreground"> [truncated]</span>}
        </span>
      )
    case 'text':
      return <span className="whitespace-pre-wrap">{event.chunk}</span>
    case 'completed':
      return <span className="text-green-600 font-medium">{event.summary || 'Completed'}</span>
    case 'error':
      return <span className="text-red-500">{event.message}</span>
    default:
      return null
  }
}

export function DaemonLogViewer({ taskId, entries, isRunning, onKill }: DaemonLogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  const taskEntries = entries.filter((e) => e.taskId === taskId)

  return (
    <div className="border rounded-md bg-black/5 dark:bg-white/5">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-xs font-medium">
            Daemon Output {taskEntries.length > 0 && `(${taskEntries.length} events)`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isRunning && onKill && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-500 hover:text-red-600" onClick={onKill}>
              <Square className="w-3 h-3 mr-1" /> Kill
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 px-2 text-xs ${autoScroll ? 'text-blue-500' : 'text-muted-foreground'}`}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <ChevronDown className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="h-64 overflow-y-auto" ref={scrollRef}>
        <div className="p-2 space-y-1 font-mono text-xs">
          {taskEntries.length === 0 && (
            <p className="text-muted-foreground text-center py-4">
              {isRunning ? 'Waiting for daemon output...' : 'No daemon events yet.'}
            </p>
          )}
          {taskEntries.map((entry, i) => (
            <div key={`${entry.timestamp}-${i}`} className="flex items-start gap-2">
              <span className="text-muted-foreground shrink-0 w-16">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}
              </span>
              <EventBadge type={entry.event.type} />
              <div className="flex-1 min-w-0 break-words">
                <EventContent event={entry.event} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
