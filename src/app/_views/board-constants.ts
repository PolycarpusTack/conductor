import type { TaskStatus, TaskPriority } from '@/types/board'

/**
 * Board-wide presentational constants (E-3). Module-level values formerly
 * defined in page.tsx and drilled through ~4 layers of props — import them
 * directly instead.
 */

export const statusColumns: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'BACKLOG', label: 'Backlog', color: 'text-3' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'text-[var(--op-blue)]' },
  { id: 'WAITING', label: 'Waiting', color: 'text-[var(--op-amber)]' },
  { id: 'REVIEW', label: 'Review', color: 'text-[var(--op-purple)]' },
  { id: 'DONE', label: 'Done', color: 'text-[var(--op-teal)]' },
]

export const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-[var(--text-dim)]',
  MEDIUM: 'bg-[var(--op-amber)]',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-[var(--op-red)]',
}

export const tagColors: Record<string, string> = {
  research: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
  docs: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)] border border-[var(--op-blue-dim)]',
  backend: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]',
  frontend: 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
  devops: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  copy: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  design: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
}

export const showDemoSeed = process.env.NODE_ENV !== 'production'
