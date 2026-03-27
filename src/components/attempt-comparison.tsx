'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, CheckCircle, AlertTriangle, Clock, Timer } from 'lucide-react'

interface Execution {
  id: string
  attempt: number
  status: string
  output?: string | null
  error?: string | null
  tokensUsed?: number | null
  cost?: number | null
  durationMs?: number | null
  startedAt: string
  completedAt?: string | null
}

interface AttemptComparisonProps {
  taskId: string
  stepId: string
  onClose: () => void
}

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  succeeded: { icon: CheckCircle, color: 'text-[#2DD4BF]', label: 'Succeeded' },
  failed: { icon: AlertTriangle, color: 'text-[#F87171]', label: 'Failed' },
  timed_out: { icon: Timer, color: 'text-[#F59E0B]', label: 'Timed Out' },
  running: { icon: Clock, color: 'text-[#60A5FA]', label: 'Running' },
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function AttemptComparison({ taskId, stepId, onClose }: AttemptComparisonProps) {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/steps/${stepId}/executions`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setExecutions(data)
          setActiveTab(data.length - 1) // default to latest
        }
      } catch (err) {
        console.error('Error fetching executions:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchExecutions()
  }, [taskId, stepId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading attempts...</div>
      </div>
    )
  }

  if (executions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-card border border-border/30 rounded-xl p-6 text-center">
          <div className="text-sm text-muted-foreground mb-4">No execution attempts found</div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  }

  // Side-by-side for 2 attempts, tabs for 3+
  const useSideBySide = executions.length === 2

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border/30 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="text-sm font-medium">
            Attempt Comparison ({executions.length} attempt{executions.length !== 1 ? 's' : ''})
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {useSideBySide ? (
          /* Side-by-side view for 2 attempts */
          <div className="flex-1 grid grid-cols-2 divide-x divide-border/30 overflow-hidden">
            {executions.map((exec) => (
              <ExecutionPanel key={exec.id} execution={exec} />
            ))}
          </div>
        ) : (
          /* Tabbed view for 3+ attempts */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex border-b border-border/30 px-4 gap-1">
              {executions.map((exec, i) => {
                const style = STATUS_STYLES[exec.status] || STATUS_STYLES.running
                return (
                  <button
                    key={exec.id}
                    onClick={() => setActiveTab(i)}
                    className={`px-3 py-2 text-xs font-mono flex items-center gap-1.5 border-b-2 transition-colors ${
                      i === activeTab
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className={style.color}>#{exec.attempt}</span>
                    <span className={`text-[10px] ${style.color}`}>{style.label}</span>
                  </button>
                )
              })}
            </div>
            <ExecutionPanel execution={executions[activeTab]} />
          </div>
        )}
      </div>
    </div>
  )
}

function ExecutionPanel({ execution }: { execution: Execution }) {
  const style = STATUS_STYLES[execution.status] || STATUS_STYLES.running
  const StatusIcon = style.icon

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-3">
        {/* Status bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-4 w-4 ${style.color}`} />
            <span className={`text-sm font-medium ${style.color}`}>
              Attempt #{execution.attempt} — {style.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            {execution.durationMs != null && (
              <span>{formatDuration(execution.durationMs)}</span>
            )}
            {execution.tokensUsed != null && (
              <span>{execution.tokensUsed.toLocaleString()} tokens</span>
            )}
            {execution.cost != null && execution.cost > 0 && (
              <span>${execution.cost.toFixed(4)}</span>
            )}
          </div>
        </div>

        {/* Error */}
        {execution.error && (
          <div className="rounded-md border border-[rgba(248,113,113,0.2)] bg-[rgba(248,113,113,0.05)] p-3">
            <div className="text-[10px] font-mono font-semibold text-[#F87171] mb-1">ERROR</div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{execution.error}</div>
          </div>
        )}

        {/* Output */}
        {execution.output && (
          <div className="rounded-md border border-border/20 bg-card/30 p-3">
            <div className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">OUTPUT</div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {execution.output}
            </div>
          </div>
        )}

        {/* Timestamp */}
        <div className="text-[10px] font-mono text-muted-foreground/50">
          Started: {new Date(execution.startedAt).toLocaleString()}
          {execution.completedAt && (
            <> — Completed: {new Date(execution.completedAt).toLocaleString()}</>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
