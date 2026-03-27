'use client'

import { useState, useEffect } from 'react'
import { Activity, CheckCircle, Clock, RotateCcw, TrendingUp } from 'lucide-react'

interface AgentStats {
  agent: { id: string; name: string; emoji: string }
  tasks: { total: number; completed: number; inProgress: number }
  steps: {
    completed7d: number
    completed30d: number
    completedAll: number
    failed: number
    successRate: number
    retryRate: number
    avgDurationMs: number
  }
  modeBreakdown: Record<string, number>
}

interface AgentActivityDashboardProps {
  agentId: string
}

const MODE_COLORS: Record<string, string> = {
  analyze: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)]',
  verify: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)]',
  develop: 'bg-[var(--op-green-bg)] text-[var(--op-green)]',
  review: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)]',
  draft: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)]',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

export function AgentActivityDashboard({ agentId }: AgentActivityDashboardProps) {
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/agents/${agentId}/stats`, { cache: 'no-store' })
        if (!res.ok) throw new Error('Failed to fetch stats')
        setStats(await res.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [agentId])

  if (loading) return <div className="text-xs text-muted-foreground py-4 text-center">Loading stats...</div>
  if (error) return <div className="text-xs text-destructive py-4 text-center">{error}</div>
  if (!stats) return null

  const modeEntries = Object.entries(stats.modeBreakdown).sort((a, b) => b[1] - a[1])
  const maxModeCount = modeEntries.length > 0 ? modeEntries[0][1] : 1

  return (
    <div className="space-y-3">
      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/30 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <CheckCircle className="h-3 w-3" />
            Tasks Completed
          </div>
          <div className="text-xl font-bold font-mono">{stats.tasks.completed}</div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {stats.tasks.inProgress} in progress · {stats.tasks.total} total
          </div>
        </div>

        <div className="rounded-lg border border-border/30 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <TrendingUp className="h-3 w-3" />
            Success Rate
          </div>
          <div className={`text-xl font-bold font-mono ${stats.steps.successRate >= 90 ? 'text-[var(--op-teal)]' : stats.steps.successRate >= 70 ? 'text-[var(--op-amber)]' : 'text-[var(--op-red)]'}`}>
            {stats.steps.successRate}%
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {stats.steps.completedAll} done · {stats.steps.failed} failed
          </div>
        </div>

        <div className="rounded-lg border border-border/30 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <Clock className="h-3 w-3" />
            Avg Step Duration
          </div>
          <div className="text-xl font-bold font-mono">
            {stats.steps.avgDurationMs > 0 ? formatDuration(stats.steps.avgDurationMs) : '\u2014'}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            per completed step
          </div>
        </div>

        <div className="rounded-lg border border-border/30 bg-card/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
            <Activity className="h-3 w-3" />
            Recent Activity
          </div>
          <div className="text-xl font-bold font-mono">{stats.steps.completed7d}</div>
          <div className="text-[10px] text-muted-foreground font-mono">
            steps last 7d · {stats.steps.completed30d} last 30d
          </div>
        </div>
      </div>

      {/* Retry rate */}
      {stats.steps.retryRate > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] px-3 py-2">
          <RotateCcw className="h-3 w-3 text-[var(--op-amber)]" />
          <span className="text-xs text-[var(--op-amber)]">
            {stats.steps.retryRate}% of steps required retries
          </span>
        </div>
      )}

      {/* Mode breakdown */}
      {modeEntries.length > 0 && (
        <div>
          <div className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Mode Breakdown
          </div>
          <div className="space-y-1.5">
            {modeEntries.map(([mode, count]) => (
              <div key={mode} className="flex items-center gap-2">
                <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded w-16 text-center ${MODE_COLORS[mode] || 'bg-muted text-muted-foreground'}`}>
                  {mode}
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/40 transition-all duration-500"
                    style={{ width: `${(count / maxModeCount) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
