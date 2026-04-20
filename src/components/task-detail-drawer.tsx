'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  X, Pencil, CheckCircle, RotateCcw,
  ChevronDown, ChevronUp,
} from 'lucide-react'
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

interface Task {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  tag?: string | null
  notes?: string | null
  output?: string | null
  agent?: { id: string; name: string; emoji: string; color: string; role?: string | null; personality?: string | null } | null
  steps?: TaskStep[]
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string
}

interface TaskDetailDrawerProps {
  task: Task
  onClose: () => void
  onEdit: () => void
  onRefresh: () => void
}

const STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)] border border-[var(--op-blue-dim)]',
  WAITING: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  REVIEW: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
  DONE: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]',
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-muted text-muted-foreground',
  MEDIUM: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  HIGH: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  URGENT: 'bg-[var(--op-red-bg)] text-[var(--op-red)] border border-[var(--op-red-dim)]',
}

const MODE_COLORS: Record<string, string> = {
  analyze: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)] border-[var(--op-blue-dim)]',
  verify: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border-[var(--op-amber-dim)]',
  develop: 'bg-[var(--op-green-bg)] text-[var(--op-green)] border-[var(--op-green-dim)]',
  review: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border-[var(--op-teal-dim)]',
  draft: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border-[var(--op-purple-dim)]',
  human: 'bg-muted/30 text-muted-foreground border-border/30',
}

const STEP_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  done: { color: 'text-[var(--op-teal)]', label: 'Done' },
  active: { color: 'text-[var(--op-blue)]', label: 'Active' },
  pending: { color: 'text-muted-foreground', label: 'Pending' },
  failed: { color: 'text-[var(--op-red)]', label: 'Failed' },
  skipped: { color: 'text-muted-foreground/50', label: 'Skipped' },
}

export function TaskDetailDrawer({ task, onClose, onEdit, onRefresh }: TaskDetailDrawerProps) {
  const [fullSteps, setFullSteps] = useState<TaskStep[]>(task.steps || [])
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [rejectingStepId, setRejectingStepId] = useState<string | null>(null)
  const [rejectionNote, setRejectionNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (!task.steps || task.steps.length === 0) return
    const abortController = new AbortController()
    const fetchSteps = async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/steps`, { cache: 'no-store', signal: abortController.signal })
        if (res.ok && !abortController.signal.aborted) {
          const data = await res.json()
          setFullSteps(data)
          const autoExpand = new Set<string>()
          data.forEach((s: TaskStep) => {
            if (s.status === 'active' || s.status === 'failed') autoExpand.add(s.id)
          })
          setExpandedSteps(autoExpand)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Error fetching steps:', err)
      }
    }
    fetchSteps()
    return () => abortController.abort()
  }, [task.id, task.steps])

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
      const res = await fetch(`/api/tasks/${task.id}/steps/${stepId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null)
        throw new Error(errorBody?.error || `Action failed (${res.status})`)
      }
      setRejectingStepId(null)
      setRejectionNote('')
      const stepsRes = await fetch(`/api/tasks/${task.id}/steps`, { cache: 'no-store' })
      if (stepsRes.ok) setFullSteps(await stepsRes.json())
      onRefresh()
    } catch (err) {
      console.error('Step action error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const doneCount = fullSteps.filter(s => s.status === 'done' || s.status === 'skipped').length

  return (
    <div className="fixed inset-y-0 right-0 w-[520px] max-w-full z-50 bg-background border-l border-border/30 shadow-2xl flex flex-col animate-slide-in">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border/30">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[task.status] || ''}`}>
              {task.status.replace('_', ' ')}
            </span>
            <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${PRIORITY_COLORS[task.priority] || ''}`}>
              {task.priority}
            </span>
            {task.tag && (
              <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded bg-muted/30">
                {task.tag}
              </span>
            )}
          </div>
          <h2 className="text-base font-semibold font-heading leading-tight">{task.title}</h2>
          {task.agent && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
              <AgentBadge agent={task.agent} size="full" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 ml-3 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">
          {/* Description */}
          {task.description && (
            <div>
              <div className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{task.description}</p>
            </div>
          )}

          {/* Notes */}
          {task.notes && (
            <div>
              <div className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Notes</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{task.notes}</p>
            </div>
          )}

          {/* Output (for non-chain tasks) */}
          {task.output && (!task.steps || task.steps.length === 0) && (
            <div>
              <div className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Output</div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap rounded-md border border-border/20 bg-card/30 p-3">
                {task.output}
              </div>
            </div>
          )}

          {/* Chain Timeline */}
          {fullSteps.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                  Workflow Chain
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {doneCount}/{fullSteps.length} steps
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-muted/30 mb-4 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--op-teal)] transition-all duration-500"
                  style={{ width: `${fullSteps.length > 0 ? (doneCount / fullSteps.length) * 100 : 0}%` }}
                />
              </div>

              {/* Steps */}
              <div className="space-y-1">
                {fullSteps.map((step, index) => {
                  const isExpanded = expandedSteps.has(step.id)
                  const config = STEP_STATUS_CONFIG[step.status] || STEP_STATUS_CONFIG.pending
                  const isLast = index === fullSteps.length - 1

                  return (
                    <div key={step.id} className="relative">
                      {!isLast && (
                        <div className="absolute left-[15px] top-[36px] bottom-0 w-[2px] bg-border/20" />
                      )}

                      <button
                        onClick={() => toggleStep(step.id)}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-card/50 transition-colors text-left"
                      >
                        <div className={`flex items-center justify-center h-[30px] w-[30px] rounded-full border flex-shrink-0 ${
                          step.status === 'active' ? 'border-[var(--op-blue)] bg-[var(--op-blue-bg)]' :
                          step.status === 'done' ? 'border-[var(--op-teal-dim)] bg-[var(--op-teal-bg)]' :
                          step.status === 'failed' ? 'border-[var(--op-red-dim)] bg-[var(--op-red-bg)]' :
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
                              <span className="text-[9px] font-mono text-[var(--op-amber)]/60">#{step.attempts + 1}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[10px] font-mono ${config.color}`}>{config.label}</span>
                            <span className={`text-[9px] font-mono ${step.autoContinue ? 'text-[var(--op-green)]/40' : 'text-[var(--op-amber)]/40'}`}>
                              {step.autoContinue ? 'auto' : 'pause'}
                            </span>
                          </div>
                        </div>

                        {(step.output || step.error || step.rejectionNote) && (
                          isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="ml-[42px] mr-2 mb-3 space-y-2">
                          {step.rejectionNote && (
                            <div className="rounded-md border border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] p-3">
                              <div className="text-[10px] font-mono font-semibold text-[var(--op-amber)] mb-1">HUMAN FEEDBACK</div>
                              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{step.rejectionNote}</div>
                            </div>
                          )}

                          {step.error && (
                            <div className="rounded-md border border-[var(--op-red-dim)] bg-[var(--op-red-bg)] p-3">
                              <div className="text-[10px] font-mono font-semibold text-[var(--op-red)] mb-1">ERROR</div>
                              <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{step.error}</div>
                            </div>
                          )}

                          {step.output && (
                            <div className="rounded-md border border-border/20 bg-card/30 p-3">
                              <div className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">OUTPUT</div>
                              <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                                {step.output}
                              </div>
                            </div>
                          )}

                          {/* Human step action buttons */}
                          {step.status === 'active' && step.mode === 'human' && (
                            <div className="space-y-2 pt-1">
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
                                    <Button size="sm" variant="outline" className="text-xs h-7 border-[var(--op-amber-dim)] text-[var(--op-amber)]"
                                      onClick={() => handleStepAction(step.id, { action: 'reject', target: 'redo', note: rejectionNote })}
                                      disabled={actionLoading || !rejectionNote.trim()}>
                                      <RotateCcw className="h-3 w-3 mr-1" /> Send Back
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-xs h-7 border-destructive/30 text-destructive"
                                      onClick={() => handleStepAction(step.id, { action: 'reject', target: 'close', note: rejectionNote || 'Closed' })}
                                      disabled={actionLoading}>
                                      <X className="h-3 w-3 mr-1" /> Close Task
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-xs h-7"
                                      onClick={() => { setRejectingStepId(null); setRejectionNote('') }}>
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Button size="sm" className="text-xs h-7 bg-[var(--op-teal)] text-background hover:bg-[var(--op-teal)]/90"
                                    onClick={() => handleStepAction(step.id, { action: 'review', decision: 'approved', reviewer: 'admin' })} disabled={actionLoading}>
                                    <CheckCircle className="h-3 w-3 mr-1" /> Approve
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-xs h-7 border-[var(--op-amber-dim)] text-[var(--op-amber)]"
                                    onClick={() => setRejectingStepId(step.id)} disabled={actionLoading}>
                                    <RotateCcw className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Failed step action buttons */}
                          {step.status === 'failed' && (
                            <div className="flex items-center gap-2 pt-1">
                              <Button size="sm" variant="outline" className="text-xs h-7 border-[var(--op-blue-dim)] text-[var(--op-blue)]"
                                onClick={() => handleStepAction(step.id, { action: 'retry' })} disabled={actionLoading}>
                                <RotateCcw className="h-3 w-3 mr-1" /> Retry
                              </Button>
                              <Button size="sm" variant="outline" className="text-xs h-7"
                                onClick={() => handleStepAction(step.id, { action: 'skip' })} disabled={actionLoading}>
                                Skip
                              </Button>
                              <Button size="sm" variant="outline" className="text-xs h-7 border-destructive/30 text-destructive"
                                onClick={() => handleStepAction(step.id, { action: 'reject', target: 'close', note: 'Closed after failure' })} disabled={actionLoading}>
                                <X className="h-3 w-3 mr-1" /> Close
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="pt-2">
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground/60">
              {task.createdAt && <div>Created: {new Date(task.createdAt).toLocaleString()}</div>}
              {task.startedAt && <div>Started: {new Date(task.startedAt).toLocaleString()}</div>}
              {task.completedAt && <div>Completed: {new Date(task.completedAt).toLocaleString()}</div>}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
