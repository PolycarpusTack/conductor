'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { X, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Clock, RotateCcw } from 'lucide-react'
import { ArtifactViewer } from '@/components/artifact-viewer'
import { AgentBadge } from '@/components/agent-badge'

interface TaskStep {
  id: string
  order: number
  mode: string
  status: string
  agentId?: string | null
  humanLabel?: string | null
  autoContinue: boolean
  output?: string | null
  error?: string | null
  rejectionNote?: string | null
  attempts?: number
  startedAt?: string | null
  completedAt?: string | null
  agent?: { id: string; name: string; emoji: string; color?: string | null; role?: string | null; personality?: string | null } | null
}

interface StepExecutionSummary {
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

interface StepArtifactSummary {
  id: string
  type: string
  label: string
  content?: string | null
  url?: string | null
  mimeType?: string | null
  metadata?: string | null
  createdAt: string
}

interface StepOutputViewerProps {
  taskId: string
  taskTitle: string
  steps: TaskStep[]
  onClose: () => void
  onRefresh?: () => void
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  done: { icon: CheckCircle, color: 'text-[var(--op-teal,#2DD4BF)]', label: 'Done' },
  active: { icon: Clock, color: 'text-[var(--op-blue,#60A5FA)]', label: 'Active' },
  pending: { icon: Clock, color: 'text-muted-foreground', label: 'Pending' },
  failed: { icon: AlertTriangle, color: 'text-[var(--op-red,#F87171)]', label: 'Failed' },
  skipped: { icon: RotateCcw, color: 'text-muted-foreground/50', label: 'Skipped' },
}

const MODE_COLORS: Record<string, string> = {
  analyze: 'bg-[var(--op-blue-bg,rgba(96,165,250,0.1))] text-[var(--op-blue,#60A5FA)] border-[var(--op-blue-dim,rgba(96,165,250,0.2))]',
  verify: 'bg-[var(--op-amber-bg,rgba(245,158,11,0.1))] text-[var(--op-amber,#F59E0B)] border-[var(--op-amber-dim,rgba(245,158,11,0.2))]',
  develop: 'bg-[var(--op-green-bg,rgba(74,222,128,0.1))] text-[var(--op-green,#4ADE80)] border-[var(--op-green-dim,rgba(74,222,128,0.2))]',
  review: 'bg-[var(--op-teal-bg,rgba(45,212,191,0.1))] text-[var(--op-teal,#2DD4BF)] border-[var(--op-teal-dim,rgba(45,212,191,0.2))]',
  draft: 'bg-[var(--op-purple-bg,rgba(167,139,250,0.1))] text-[var(--op-purple,#A78BFA)] border-[var(--op-purple-dim,rgba(167,139,250,0.2))]',
  human: 'bg-muted/30 text-muted-foreground border-border/30',
}

export function StepOutputViewer({ taskId, taskTitle, steps, onClose, onRefresh }: StepOutputViewerProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [fullSteps, setFullSteps] = useState<TaskStep[]>(steps)
  const [loading, setLoading] = useState(false)
  const [rejectingStepId, setRejectingStepId] = useState<string | null>(null)
  const [rejectionNote, setRejectionNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [executionHistory, setExecutionHistory] = useState<Record<string, StepExecutionSummary[]>>({})
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set())
  const [stepArtifacts, setStepArtifacts] = useState<Record<string, StepArtifactSummary[]>>({})

  const fetchExecutions = useCallback(async (stepId: string) => {
    if (executionHistory[stepId]) {
      // Toggle visibility
      setExpandedExecutions(prev => {
        const next = new Set(prev)
        if (next.has(stepId)) next.delete(stepId)
        else next.add(stepId)
        return next
      })
      return
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}/steps/${stepId}/executions`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setExecutionHistory(prev => ({ ...prev, [stepId]: data }))
        setExpandedExecutions(prev => new Set(prev).add(stepId))
      }
    } catch (err) {
      console.error('Error fetching executions:', err)
    }
  }, [taskId, executionHistory])

  // Clear stale execution/artifact data when task changes
  useEffect(() => {
    setExecutionHistory({})
    setExpandedExecutions(new Set())
    setStepArtifacts({})
  }, [taskId])

  // Fetch full step data including outputs
  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()
    const fetchSteps = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/tasks/${taskId}/steps`, { cache: 'no-store', signal: abortController.signal })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setFullSteps(data)
          // Auto-expand active or failed steps
          const autoExpand = new Set<string>()
          data.forEach((s: TaskStep) => {
            if (s.status === 'active' || s.status === 'failed' || (s.status === 'done' && s.output)) {
              autoExpand.add(s.id)
            }
          })
          setExpandedSteps(autoExpand)

          // Fetch artifacts for all steps that have output (likely have artifacts)
          for (const s of data) {
            if (cancelled) break
            if (s.status === 'done' || s.output) {
              fetch(`/api/tasks/${taskId}/steps/${s.id}/artifacts`, { cache: 'no-store', signal: abortController.signal })
                .then(r => r.ok ? r.json() : [])
                .then(artifacts => {
                  if (!cancelled && artifacts.length > 0) {
                    setStepArtifacts(prev => ({ ...prev, [s.id]: artifacts }))
                  }
                })
                .catch(() => {})
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Error fetching steps:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchSteps()
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [taskId])

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const handleStepAction = async (stepId: string, action: Record<string, unknown>) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/steps/${stepId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Action failed')
      }
      setRejectingStepId(null)
      setRejectionNote('')
      // Re-fetch steps
      const stepsRes = await fetch(`/api/tasks/${taskId}/steps`, { cache: 'no-store' })
      if (stepsRes.ok) setFullSteps(await stepsRes.json())
      onRefresh?.()
    } catch (err) {
      console.error('Step action error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleApprove = (stepId: string) => {
    handleStepAction(stepId, { action: 'review', decision: 'approved', reviewer: 'admin' })
  }

  const handleRetry = (stepId: string) => {
    handleStepAction(stepId, { action: 'retry' })
  }

  const handleSkip = (stepId: string) => {
    handleStepAction(stepId, { action: 'skip' })
  }

  const handleRejectRedo = (stepId: string) => {
    if (!rejectionNote.trim()) return
    handleStepAction(stepId, { action: 'reject', target: 'redo', note: rejectionNote })
  }

  const handleClose = (stepId: string) => {
    handleStepAction(stepId, { action: 'reject', target: 'close', note: rejectionNote || 'Closed by human' })
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] max-w-full z-50 bg-background border-l border-border/30 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-card/50">
        <div className="min-w-0">
          <div className="text-xs font-mono text-muted-foreground">Chain Progress</div>
          <div className="text-sm font-medium truncate">{taskTitle}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Steps Timeline */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-1">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">Loading steps...</div>
          ) : fullSteps.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">No chain steps</div>
          ) : (
            fullSteps.map((step, index) => {
              const isExpanded = expandedSteps.has(step.id)
              const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending
              const StatusIcon = config.icon
              const isLast = index === fullSteps.length - 1

              return (
                <div key={step.id} className="relative">
                  {/* Connector line */}
                  {!isLast && (
                    <div className="absolute left-[15px] top-[36px] bottom-0 w-[2px] bg-border/30" />
                  )}

                  {/* Step header */}
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-card/50 transition-colors text-left"
                  >
                    <div className={`flex items-center justify-center h-[30px] w-[30px] rounded-full border flex-shrink-0 ${
                      step.status === 'active' ? 'border-[var(--op-blue,#60A5FA)] bg-[var(--op-blue-bg,rgba(96,165,250,0.1))]' :
                      step.status === 'done' ? 'border-[var(--op-teal-dim,rgba(45,212,191,0.2))] bg-[var(--op-teal-bg,rgba(45,212,191,0.1))]' :
                      step.status === 'failed' ? 'border-[var(--op-red-dim,rgba(248,113,113,0.2))] bg-[var(--op-red-bg,rgba(248,113,113,0.1))]' :
                      'border-border/30 bg-card/30'
                    }`}>
                      <span className="text-xs font-mono font-bold text-muted-foreground">{step.order}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${MODE_COLORS[step.mode] || MODE_COLORS.human}`}>
                          {step.mode}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {step.agent ? <AgentBadge agent={step.agent} size="card" /> : (step.humanLabel || 'Human')}
                        </span>
                        {step.attempts && step.attempts > 0 && (
                          <span className="text-[9px] font-mono text-muted-foreground/60">
                            attempt #{step.attempts + 1}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <StatusIcon className={`h-3 w-3 ${config.color}`} />
                        <span className={`text-[10px] font-mono ${config.color}`}>{config.label}</span>
                        {step.autoContinue ? (
                          <span className="text-[9px] font-mono text-[var(--op-green,#4ADE80)]/50">auto</span>
                        ) : (
                          <span className="text-[9px] font-mono text-[var(--op-amber,#F59E0B)]/50">pause</span>
                        )}
                      </div>
                    </div>

                    {(step.output || step.error || step.rejectionNote) && (
                      isExpanded
                        ? <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        : <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="ml-[42px] mr-2 mb-3 space-y-2">
                      {step.rejectionNote && (
                        <div className="rounded-md border border-[var(--op-amber-dim,rgba(245,158,11,0.2))] bg-[var(--op-amber-bg,rgba(245,158,11,0.05))] p-3">
                          <div className="text-[10px] font-mono font-semibold text-[var(--op-amber,#F59E0B)] mb-1">
                            HUMAN FEEDBACK
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap">{step.rejectionNote}</div>
                        </div>
                      )}

                      {step.error && (
                        <div className="rounded-md border border-[var(--op-red-dim,rgba(248,113,113,0.2))] bg-[var(--op-red-bg,rgba(248,113,113,0.05))] p-3">
                          <div className="text-[10px] font-mono font-semibold text-[var(--op-red,#F87171)] mb-1">
                            ERROR
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{step.error}</div>
                        </div>
                      )}

                      {step.output && (
                        <div className="rounded-md border border-border/20 bg-card/30 p-3">
                          <div className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                            OUTPUT
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                            {step.output}
                          </div>
                        </div>
                      )}

                      {/* Artifacts */}
                      {stepArtifacts[step.id] && stepArtifacts[step.id].length > 0 && (
                        <ArtifactViewer artifacts={stepArtifacts[step.id]} />
                      )}

                      {/* Action buttons */}
                      {step.status === 'active' && step.mode === 'human' && (
                        <div className="space-y-2">
                          {rejectingStepId === step.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={rejectionNote}
                                onChange={e => setRejectionNote(e.target.value)}
                                placeholder="Explain what needs to change..."
                                rows={3}
                                className="text-xs"
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 border-[var(--op-amber-dim)] text-[var(--op-amber)]"
                                  onClick={() => handleRejectRedo(step.id)}
                                  disabled={actionLoading || !rejectionNote.trim()}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Send Back
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 border-destructive/30 text-destructive"
                                  onClick={() => handleClose(step.id)}
                                  disabled={actionLoading}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Close Task
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs h-7"
                                  onClick={() => { setRejectingStepId(null); setRejectionNote('') }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                className="text-xs h-7 bg-[var(--op-teal)] text-background hover:bg-[var(--op-teal)]/90"
                                onClick={() => handleApprove(step.id)}
                                disabled={actionLoading}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 border-[var(--op-amber-dim)] text-[var(--op-amber)]"
                                onClick={() => setRejectingStepId(step.id)}
                                disabled={actionLoading}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {step.status === 'failed' && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 border-[var(--op-blue-dim)] text-[var(--op-blue)]"
                            onClick={() => handleRetry(step.id)}
                            disabled={actionLoading}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => handleSkip(step.id)}
                            disabled={actionLoading}
                          >
                            Skip
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 border-destructive/30 text-destructive"
                            onClick={() => handleClose(step.id)}
                            disabled={actionLoading}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Close Task
                          </Button>
                        </div>
                      )}

                      {/* Execution History */}
                      {step.agent && (step.attempts ?? 0) > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => fetchExecutions(step.id)}
                            className="text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                          >
                            {expandedExecutions.has(step.id) ? '- Hide' : '+ Show'} execution history
                            {step.attempts ? ` (${step.attempts} attempt${step.attempts !== 1 ? 's' : ''})` : ''}
                          </button>

                          {expandedExecutions.has(step.id) && executionHistory[step.id] && (
                            <div className="mt-2 space-y-1.5">
                              {executionHistory[step.id].map((exec) => (
                                <div
                                  key={exec.id}
                                  className="rounded border border-border/20 bg-card/20 p-2 text-[10px] font-mono"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold">#{exec.attempt}</span>
                                      <span className={
                                        exec.status === 'succeeded' ? 'text-[var(--op-teal)]' :
                                        exec.status === 'failed' ? 'text-[var(--op-red)]' :
                                        exec.status === 'timed_out' ? 'text-[var(--op-amber)]' :
                                        'text-[var(--op-blue)]'
                                      }>
                                        {exec.status}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-muted-foreground/50">
                                      {exec.durationMs != null && (
                                        <span>{exec.durationMs < 1000 ? `${exec.durationMs}ms` : `${(exec.durationMs / 1000).toFixed(1)}s`}</span>
                                      )}
                                      {exec.tokensUsed != null && (
                                        <span>{exec.tokensUsed.toLocaleString()} tokens</span>
                                      )}
                                    </div>
                                  </div>
                                  {exec.error && (
                                    <div className="text-[var(--op-red)]/70 truncate">{exec.error}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
