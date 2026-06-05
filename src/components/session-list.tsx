'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, Terminal, ChevronDown, ChevronUp } from 'lucide-react'

export interface AgentSessionSummary {
  id: string
  workspaceId: string
  projectId: string | null
  agentId: string | null
  daemonId: string
  hostId: string | null
  taskId: string | null
  stepId: string | null
  sessionKey: string
  backend: string
  cwd: string | null
  command: string | null
  status: string
  lastActivityAt: string | null
  startedAt: string
  endedAt: string | null
  exitCode: number | null
  outputPreview: string | null
  host?: { id: string; displayName: string; hostname: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  starting: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  active: 'bg-green-500/15 text-green-600 border-green-500/30',
  idle: 'bg-gray-500/15 text-gray-500 border-gray-500/30',
  waiting: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  exited: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/15 text-red-600 border-red-500/30',
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function SessionList({ sessions }: { sessions: AgentSessionSummary[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const isExpanded = expanded.has(session.id)
        return (
          <Card key={session.id}>
            <CardContent className="py-2.5 px-3">
              <div
                className="flex items-center justify-between gap-3 cursor-pointer"
                onClick={() => toggle(session.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_STYLES[session.status] || ''}`}>
                    {session.status}
                    {session.exitCode !== null && session.exitCode !== 0 ? ` (${session.exitCode})` : ''}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{session.backend}</Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{session.sessionKey}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {session.command || session.cwd || '—'}
                      {session.host ? ` · ${session.host.displayName}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
                  {relativeTime(session.lastActivityAt) ?? ''}
                  {session.outputPreview &&
                    (isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                </div>
              </div>

              {isExpanded && session.outputPreview && (
                <pre className="mt-2 rounded border border-border/30 bg-black/40 p-2 text-[10px] font-mono whitespace-pre-wrap max-h-64 overflow-y-auto text-muted-foreground">
                  {session.outputPreview}
                </pre>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

/** Self-fetching, polling sessions list — the Sessions tab of the Runtime Dashboard. */
export function SessionsPanel() {
  const [sessions, setSessions] = useState<AgentSessionSummary[] | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions)
      }
    } catch {
      // keep previous list on transient failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10_000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  if (sessions === null) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        Loading sessions...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Sessions</h3>
        <Button variant="ghost" size="sm" onClick={fetchSessions} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm space-y-1">
            <Terminal className="w-5 h-5 mx-auto mb-2 opacity-40" />
            <p>No sessions reported yet.</p>
            <p>Sessions appear when a daemon reports local execution sessions (pty, tmux, process).</p>
          </CardContent>
        </Card>
      ) : (
        <SessionList sessions={sessions} />
      )}
    </div>
  )
}

/** Task-scoped sessions — the execution section of the task detail drawer. */
export function TaskSessions({ taskId }: { taskId: string }) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions?taskId=${encodeURIComponent(taskId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data) => {
        if (!cancelled) setSessions(data.sessions)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [taskId])

  if (sessions.length === 0) return null

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Execution Sessions
      </h3>
      <SessionList sessions={sessions} />
    </div>
  )
}
