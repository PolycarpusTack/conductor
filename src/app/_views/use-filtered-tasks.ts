import { useMemo } from 'react'
import type { Task, TaskPriority } from '@/types/board'

/**
 * D-1: client-side board filtering. The board already holds every task for the
 * current project (currentProject.tasks), so filtering is a pure, memoized
 * transform over that array — no server round-trip, no pagination (that is
 * deferred to D-1b if task counts grow).
 *
 * A `null`/empty value on any dimension means "no constraint on that dimension";
 * populated dimensions combine with AND semantics.
 */
export interface BoardFilter {
  /** Case-insensitive substring over title + description; trimmed before matching. */
  text: string
  /** Exact Agent.id, or null for any agent (including unassigned). */
  agentId: string | null
  /** Exact priority, or null for any. */
  priority: TaskPriority | null
  /** Exact tag, or null for any. */
  tag: string | null
  /**
   * D-2: when true, keep only tasks that are past their due date and not yet
   * DONE (a completed task is never "overdue"). Tasks with no due date are
   * excluded. false = no constraint on this dimension.
   */
  overdue: boolean
}

export const emptyBoardFilter: BoardFilter = {
  text: '',
  agentId: null,
  priority: null,
  tag: null,
  overdue: false,
}

/** True when at least one dimension constrains the result set. */
export function isBoardFilterActive(filter: BoardFilter): boolean {
  return (
    filter.text.trim() !== '' ||
    filter.agentId !== null ||
    filter.priority !== null ||
    filter.tag !== null ||
    filter.overdue
  )
}

/** A task is overdue when it has a due date in the past and isn't DONE. */
export function isTaskOverdue(task: Task, now: number = Date.now()): boolean {
  if (!task.dueDate || task.status === 'DONE') return false
  const due = new Date(task.dueDate).getTime()
  return !Number.isNaN(due) && due < now
}

/**
 * Returns the subset of `tasks` matching `filter`. When the filter is inactive
 * the original array reference is returned unchanged, so downstream memoization
 * (BoardPage's tasksByStatus) keeps its identity when no filter is applied.
 */
export function filterTasks(tasks: Task[], filter: BoardFilter): Task[] {
  if (!isBoardFilterActive(filter)) return tasks
  const text = filter.text.trim().toLowerCase()
  // Snapshot "now" once per pass so every task is judged against the same instant.
  const now = Date.now()
  return tasks.filter((task) => {
    if (text) {
      const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase()
      if (!haystack.includes(text)) return false
    }
    if (filter.agentId !== null && task.agent?.id !== filter.agentId) return false
    if (filter.priority !== null && task.priority !== filter.priority) return false
    if (filter.tag !== null && task.tag !== filter.tag) return false
    if (filter.overdue && !isTaskOverdue(task, now)) return false
    return true
  })
}

/** Memoized `filterTasks` over [tasks, filter] for use in board render paths. */
export function useFilteredTasks(tasks: Task[], filter: BoardFilter): Task[] {
  return useMemo(() => filterTasks(tasks, filter), [tasks, filter])
}
