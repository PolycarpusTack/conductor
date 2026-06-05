'use client'

import { Button } from '@/components/ui/button'
import { Eye, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { AgentBadge } from '@/components/agent-badge'
import { ActivityTail } from '@/components/activity-tail'
import type { Task, TaskPriority, TaskStepSummary } from '@/types/board'
import type { LiveAgentLogEntry } from '@/types/live-agent'

interface BoardTaskCardProps {
  task: Task
  priorityColors: Record<TaskPriority, string>
  tagColors: Record<string, string>
  onOpen: (task: Task) => void
  onViewSteps: (viewing: { id: string; title: string; steps: TaskStepSummary[] }) => void
  /** Desktop-only affordances; omitted in the mobile single-column view */
  draggable?: boolean
  onDragStart?: (task: Task) => void
  onEdit?: (task: Task) => void
  onDelete?: (id: string) => void
  liveAgentLogs?: LiveAgentLogEntry[]
}

export function BoardTaskCard({
  task,
  priorityColors,
  tagColors,
  onOpen,
  onViewSteps,
  draggable = false,
  onDragStart,
  onEdit,
  onDelete,
  liveAgentLogs,
}: BoardTaskCardProps) {
  const steps = task.steps ?? []
  const activeStep = steps.find((s) => s.status === 'active')
  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const currentStep = activeStep || steps[doneCount]

  return (
    <div
      draggable={draggable}
      onDragStart={draggable && onDragStart ? () => onDragStart(task) : undefined}
      onClick={() => onOpen(task)}
      className="group relative rounded-lg border border-border/40 bg-card p-3 cursor-pointer hover:border-border/60 transition-colors"
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/20 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${priorityColors[task.priority]}`} />
              <span className="text-[13px] font-medium leading-tight text-foreground/90">{task.title}</span>
            </div>
            {task.agent && (
              <AgentBadge agent={task.agent} size="compact" className="shrink-0" />
            )}
          </div>

          {steps.length > 0 && currentStep && (
            <div className="text-[10px] font-mono text-muted-foreground mt-1">
              Step {currentStep.order}/{steps.length} · {currentStep.mode}
            </div>
          )}

          {steps.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewSteps({ id: task.id, title: task.title, steps }) }}
              className="absolute top-2 right-2 p-1 rounded hover:bg-card/80 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <Eye className="h-3 w-3" />
            </button>
          )}

          {task.notes && (
            <div className="mt-2 rounded-md bg-surface/60 px-2 py-1.5">
              <p className="text-[10px] leading-snug text-muted-foreground line-clamp-2">{task.notes}</p>
            </div>
          )}

          {liveAgentLogs && task.status === 'IN_PROGRESS' && (
            <ActivityTail
              taskId={task.id}
              events={liveAgentLogs.filter((l) => l.taskId === task.id)}
            />
          )}

          <div className="mt-2 flex items-center justify-between">
            {task.tag ? (
              <span className={`rounded px-1.5 py-0.5 text-[9px] ${tagColors[task.tag] || 'bg-surface text-muted-foreground'}`}>
                {task.tag}
              </span>
            ) : <div />}
            {(onEdit || onDelete) && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => { e.stopPropagation(); onEdit(task) }}
                  >
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
                  >
                    <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
