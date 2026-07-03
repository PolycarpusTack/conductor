'use client'

import { memo } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Eye, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentBadge } from '@/components/agent-badge'
import { ActivityTail } from '@/components/activity-tail'
import { useLiveAgentLogs } from '@/app/_views/board-context'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import type { Task, TaskPriority, TaskStepSummary } from '@/types/board'

/**
 * E-5: the ONLY subscriber to the high-frequency live-logs context on the
 * board render path. Mounted per in-progress card, so an `agent-live-event`
 * re-renders just these leaves — never `BoardPage`, the columns, or the card
 * bodies (which no longer read the context at all).
 *
 * The filtered slice is a fresh array each event, but `ActivityTail` is
 * memoized with an element-wise `events` comparator, so an event for a
 * *different* task yields an equal slice here and the tail bails: only the
 * tail whose task actually got the event re-renders its DOM.
 */
function CardActivityTail({ taskId }: { taskId: string }) {
  const liveAgentLogs = useLiveAgentLogs()
  const events = liveAgentLogs.filter((l) => l.taskId === taskId)
  return <ActivityTail taskId={taskId} events={events} />
}

/**
 * dnd-kit wiring supplied by the sortable wrapper on the desktop board (E-4).
 * When present, the card root is the draggable node and the grip is the drag
 * handle (pointer + keyboard activator). Absent on the mobile single-column
 * view and inside the DragOverlay.
 */
export interface CardSortable {
  setNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  isDragging: boolean
}

interface BoardTaskCardProps {
  task: Task
  priorityColors: Record<TaskPriority, string>
  tagColors: Record<string, string>
  onOpen: (task: Task) => void
  onViewSteps: (viewing: { id: string; title: string; steps: TaskStepSummary[] }) => void
  onEdit?: (task: Task) => void
  onDelete?: (id: string) => void
  /**
   * E-5: opt-in flag (not the log array). When true, an in-progress card
   * mounts `CardActivityTail`, which subscribes to the live-logs context on
   * its own — so the card body never re-renders on `agent-live-event`. A
   * boolean literal is referentially stable, so `memo(BoardTaskCard)` holds.
   * Omitted on the mobile view (no tail there — unchanged behaviour).
   */
  liveActivity?: boolean
  /** dnd-kit sortable wiring (desktop only). */
  sortable?: CardSortable
  /** Rendered inside the DragOverlay: static lifted appearance, no interaction. */
  overlay?: boolean
}

export const BoardTaskCard = memo(function BoardTaskCard({
  task,
  priorityColors,
  tagColors,
  onOpen,
  onViewSteps,
  onEdit,
  onDelete,
  liveActivity = false,
  sortable,
  overlay = false,
}: BoardTaskCardProps) {
  const steps = task.steps ?? []
  const activeStep = steps.find((s) => s.status === 'active')
  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const currentStep = activeStep || steps[doneCount]

  // Grip is a drag handle on the desktop board and a static affordance in the
  // overlay; the mobile view (no sortable, no overlay) renders no grip.
  const showGrip = Boolean(sortable) || overlay

  // Enter/Space opens the drawer — but only when the card root itself holds
  // focus, so the grip handle's own Space/Enter (which the KeyboardSensor uses
  // to lift the card) never doubles as an "open".
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (overlay) return
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(task)
    }
  }

  return (
    <div
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      role="button"
      tabIndex={overlay ? -1 : 0}
      aria-label={`Open task: ${task.title}`}
      onClick={overlay ? undefined : () => onOpen(task)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative rounded-lg border border-border/40 bg-card p-3 transition-colors',
        'hover:border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        !overlay && 'cursor-pointer',
        sortable?.isDragging && 'opacity-40',
        overlay && 'cursor-grabbing shadow-lg ring-1 ring-border/60',
      )}
    >
      <div className="flex items-start gap-2">
        {showGrip && (
          sortable ? (
            <button
              type="button"
              {...sortable.attributes}
              {...sortable.listeners}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Drag to move task: ${task.title}. Press space or enter to lift, arrow keys to move between columns, space to drop, escape to cancel.`}
              className="mt-0.5 shrink-0 cursor-grab touch-none rounded text-muted-foreground/20 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          ) : (
            <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
          )
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

          {liveActivity && task.status === 'IN_PROGRESS' && (
            <CardActivityTail taskId={task.id} />
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
})
