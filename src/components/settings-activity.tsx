'use client'

import { useState, useEffect, useCallback } from 'react'
import { Trash2, Download, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DeadLetterPanel } from '@/components/dead-letter-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogComponent = 'task' | 'agent' | 'daemon' | 'wizard' | 'runtime' | 'system'

interface ActivityEntry {
  id: string
  action: string
  level: LogLevel
  component: string | null
  traceId: string | null
  taskId: string | null
  agentId: string | null
  details: string | null
  createdAt: string
  agent?: { name: string; emoji: string } | null
  user?: { name: string; email: string } | null
}

interface SettingsActivityProps {
  projectId: string
}

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'forever', label: 'Keep forever' },
]

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  info:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  warn:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function SettingsActivity({ projectId }: SettingsActivityProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [purging, setPurging] = useState(false)
  const [saving, setSaving] = useState(false)

  const [retentionDays, setRetentionDays] = useState<string>('forever')
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [filterComponent, setFilterComponent] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Load project's current retention setting
  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (data.logRetentionDays) {
          setRetentionDays(String(data.logRetentionDays))
        } else {
          setRetentionDays('forever')
        }
      })
      .catch(() => {})
  }, [projectId])

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Recently deleted tasks (Epic S3) — 30-day restore window
  const [deletedTasks, setDeletedTasks] = useState<Array<{ id: string; title: string; deletedAt: string }>>([])
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const fetchDeletedTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/deleted-tasks`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setDeletedTasks(data.tasks)
      }
    } catch {}
  }, [projectId])

  useEffect(() => { void fetchDeletedTasks() }, [fetchDeletedTasks])

  const restoreTask = async (taskId: string) => {
    setRestoringId(taskId)
    try {
      const res = await fetch(`/api/tasks/${taskId}/restore`, { method: 'POST' })
      if (res.ok) setDeletedTasks(prev => prev.filter(t => t.id !== taskId))
    } finally {
      setRestoringId(null)
    }
  }

  // Archived tasks (Epic S7) — kept forever, hidden from the board
  const [archivedTasks, setArchivedTasks] = useState<Array<{ id: string; title: string; archivedAt: string }>>([])
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null)

  const fetchArchivedTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/archived-tasks`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setArchivedTasks(data.tasks)
      }
    } catch {}
  }, [projectId])

  useEffect(() => { void fetchArchivedTasks() }, [fetchArchivedTasks])

  const unarchiveTask = async (taskId: string) => {
    setUnarchivingId(taskId)
    try {
      const res = await fetch(`/api/tasks/${taskId}/unarchive`, { method: 'POST' })
      if (res.ok) setArchivedTasks(prev => prev.filter(t => t.id !== taskId))
    } finally {
      setUnarchivingId(null)
    }
  }

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ projectId, limit: '200' })
      if (filterLevel !== 'all') params.set('level', filterLevel)
      if (filterComponent !== 'all') params.set('component', filterComponent)
      if (search) params.set('search', search)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', `${toDate}T23:59:59`)
      const res = await fetch(`/api/activity?${params}`)
      if (res.ok) setEntries(await res.json())
    } finally {
      setLoading(false)
    }
  }, [projectId, filterLevel, filterComponent, search, fromDate, toDate])

  useEffect(() => { void fetchLogs() }, [fetchLogs])

  const handleSearchCommit = () => setSearch(searchInput)

  const saveRetention = async () => {
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          logRetentionDays: retentionDays === 'forever' ? null : parseInt(retentionDays, 10),
        }),
      })
    } finally {
      setSaving(false)
    }
  }

  const purgeNow = async () => {
    if (retentionDays === 'forever') return
    setPurging(true)
    try {
      const res = await fetch('/api/activity/purge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, retentionDays: parseInt(retentionDays, 10) }),
      })
      if (res.ok) {
        const { deleted } = await res.json()
        await fetchLogs()
        if (deleted > 0) {
          console.info(`[activity] purged ${deleted} entries older than ${retentionDays} days`)
        }
      }
    } finally {
      setPurging(false)
    }
  }

  const exportLogs = (format: 'jsonl' | 'csv') => {
    const params = new URLSearchParams({ projectId, format, limit: '50000' })
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', `${toDate}T23:59:59`)
    window.open(`/api/activity/export?${params}`, '_blank')
  }

  return (
    <div className="space-y-5">
      {/* Exhausted steps awaiting operator attention (hidden when empty) */}
      <DeadLetterPanel projectId={projectId} />

      {/* Recently deleted tasks — 30-day restore window (Epic S3) */}
      {deletedTasks.length > 0 && (
        <div className="rounded-lg border border-border p-4 space-y-2">
          <div>
            <p className="text-sm font-medium">Recently Deleted Tasks</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Restorable for 30 days after deletion, then purged permanently.
            </p>
          </div>
          <div className="space-y-1.5">
            {deletedTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 p-2 rounded bg-muted/20">
                <span className="text-xs flex-1 truncate">{task.title}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                  deleted {new Date(task.deletedAt).toLocaleDateString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={restoringId === task.id}
                  onClick={() => restoreTask(task.id)}
                >
                  {restoringId === task.id ? 'Restoring…' : 'Restore'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Archived tasks (Epic S7) — kept forever, hidden from the board */}
      {archivedTasks.length > 0 && (
        <div className="rounded-lg border border-border p-4 space-y-2">
          <div>
            <p className="text-sm font-medium">Archived Tasks</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hidden from the board but kept forever — unarchive to bring one back.
            </p>
          </div>
          <div className="space-y-1.5">
            {archivedTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 p-2 rounded bg-muted/20">
                <span className="text-xs flex-1 truncate">{task.title}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                  archived {new Date(task.archivedAt).toLocaleDateString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={unarchivingId === task.id}
                  onClick={() => unarchiveTask(task.id)}
                >
                  {unarchivingId === task.id ? 'Unarchiving…' : 'Unarchive'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retention settings */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Log Retention</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Entries older than this are removed automatically on each activity fetch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={retentionDays} onValueChange={setRetentionDays}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={saveRetention} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {retentionDays !== 'forever' && (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 text-xs gap-1"
              onClick={purgeNow}
              disabled={purging}
            >
              <Trash2 className="h-3 w-3" />
              {purging ? 'Purging…' : 'Purge now'}
            </Button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            className="h-8 text-xs pl-7"
            placeholder="Search action or details…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearchCommit()}
          />
        </div>

        <Input
          type="date"
          aria-label="From date"
          className="h-8 text-xs w-36"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
        />
        <Input
          type="date"
          aria-label="To date"
          className="h-8 text-xs w-36"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
        />

        <Select value={filterLevel} onValueChange={setFilterLevel}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All levels</SelectItem>
            <SelectItem value="debug" className="text-xs">Debug</SelectItem>
            <SelectItem value="info" className="text-xs">Info</SelectItem>
            <SelectItem value="warn" className="text-xs">Warn</SelectItem>
            <SelectItem value="error" className="text-xs">Error</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterComponent} onValueChange={setFilterComponent}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue placeholder="Component" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All components</SelectItem>
            {(['task','agent','daemon','wizard','runtime','system'] as LogComponent[]).map(c => (
              <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={fetchLogs} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>

        <div className="flex gap-1 ml-auto">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => exportLogs('jsonl')}>
            <Download className="h-3 w-3" />JSONL
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => exportLogs('csv')}>
            <Download className="h-3 w-3" />CSV
          </Button>
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/30 px-3 py-1.5 flex items-center justify-between border-b border-border">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {entries.length} entries
          </span>
          <span className="text-[10px] text-muted-foreground">newest first</span>
        </div>

        <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No entries match the current filters</div>
          ) : (
            entries.map(entry => (
              <LogRow key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function LogRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false)
  const level = (entry.level ?? 'info') as LogLevel
  const levelClass = LEVEL_COLORS[level] ?? LEVEL_COLORS.info

  let parsedDetails: Record<string, unknown> | null = null
  if (entry.details) {
    try { parsedDetails = JSON.parse(entry.details) } catch {}
  }

  return (
    <div
      className="px-3 py-2 hover:bg-muted/20 cursor-pointer text-xs font-mono"
      onClick={() => setExpanded(v => !v)}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-muted-foreground/50 shrink-0 w-[90px] text-right">
          {timeAgo(entry.createdAt)}
        </span>

        <Badge variant="outline" className={`shrink-0 text-[9px] px-1 py-0 ${levelClass}`}>
          {level}
        </Badge>

        {entry.component && (
          <span className="shrink-0 text-muted-foreground/70">{entry.component}</span>
        )}

        <span className="truncate text-foreground/90 flex-1">
          {entry.agent ? `${entry.agent.emoji} ${entry.agent.name} · ` : ''}{entry.user ? `👤 ${entry.user.name} · ` : ''}{entry.action}
        </span>

        {entry.traceId && (
          <span className="shrink-0 text-muted-foreground/40 text-[9px]">
            {entry.traceId.slice(0, 8)}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-1.5 ml-[106px] space-y-1">
          {entry.taskId && (
            <div className="text-muted-foreground">task: {entry.taskId}</div>
          )}
          {entry.traceId && (
            <div className="text-muted-foreground">trace: {entry.traceId}</div>
          )}
          {parsedDetails && (
            <pre className="text-[10px] bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(parsedDetails, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
