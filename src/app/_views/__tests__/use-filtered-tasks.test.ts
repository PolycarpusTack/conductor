import { describe, test, expect } from 'bun:test'
import { filterTasks, isBoardFilterActive, isTaskOverdue, emptyBoardFilter, type BoardFilter } from '../use-filtered-tasks'
import type { Task, TaskPriority, TaskStatus, Agent } from '@/types/board'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function agent(id: string, name: string): Agent {
  return { id, name, emoji: '🤖', color: '#fff', isActive: true, maxConcurrent: 1 }
}

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: overrides.id ?? `t${seq}`,
    title: overrides.title ?? 'Task',
    description: overrides.description,
    status: (overrides.status ?? 'BACKLOG') as TaskStatus,
    priority: (overrides.priority ?? 'MEDIUM') as TaskPriority,
    tag: overrides.tag,
    agent: overrides.agent ?? null,
    order: overrides.order ?? 0,
    dueDate: overrides.dueDate,
  }
}

const filter = (over: Partial<BoardFilter> = {}): BoardFilter => ({ ...emptyBoardFilter, ...over })

const alice = agent('a1', 'Alice')
const bob = agent('a2', 'Bob')

const tasks: Task[] = [
  task({ id: 't1', title: 'Fix login bug', description: 'Auth flow broken', priority: 'HIGH', tag: 'backend', agent: alice }),
  task({ id: 't2', title: 'Write docs', description: 'API reference', priority: 'LOW', tag: 'docs', agent: bob }),
  task({ id: 't3', title: 'Design landing page', description: 'Hero section', priority: 'MEDIUM', tag: 'design', agent: alice }),
  task({ id: 't4', title: 'Refactor auth module', description: undefined, priority: 'HIGH', tag: 'backend', agent: null }),
  task({ id: 't5', title: 'Update dependencies', description: 'Bump packages', priority: 'URGENT', tag: 'devops', agent: bob }),
]

const ids = (result: Task[]) => result.map((t) => t.id)

// ---------------------------------------------------------------------------
// isBoardFilterActive
// ---------------------------------------------------------------------------

describe('isBoardFilterActive', () => {
  test('empty filter is inactive', () => {
    expect(isBoardFilterActive(emptyBoardFilter)).toBe(false)
  })

  test('whitespace-only text is inactive', () => {
    expect(isBoardFilterActive(filter({ text: '   ' }))).toBe(false)
  })

  test('any populated dimension is active', () => {
    expect(isBoardFilterActive(filter({ text: 'a' }))).toBe(true)
    expect(isBoardFilterActive(filter({ agentId: 'a1' }))).toBe(true)
    expect(isBoardFilterActive(filter({ priority: 'HIGH' }))).toBe(true)
    expect(isBoardFilterActive(filter({ tag: 'backend' }))).toBe(true)
    expect(isBoardFilterActive(filter({ overdue: true }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isTaskOverdue + overdue filter (D-2)
// ---------------------------------------------------------------------------

const PAST_ISO = '2020-01-01T23:59:59.999Z'
const FUTURE_ISO = '2999-01-01T23:59:59.999Z'

describe('isTaskOverdue', () => {
  test('past due date on an active task is overdue', () => {
    expect(isTaskOverdue(task({ dueDate: PAST_ISO, status: 'IN_PROGRESS' }))).toBe(true)
  })

  test('future due date is not overdue', () => {
    expect(isTaskOverdue(task({ dueDate: FUTURE_ISO }))).toBe(false)
  })

  test('no due date is never overdue', () => {
    expect(isTaskOverdue(task({ dueDate: undefined }))).toBe(false)
  })

  test('a DONE task past its due date is not overdue', () => {
    expect(isTaskOverdue(task({ dueDate: PAST_ISO, status: 'DONE' }))).toBe(false)
  })

  test('a due date exactly at now is not overdue (strict past)', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0)
    expect(isTaskOverdue(task({ dueDate: new Date(now).toISOString() }), now)).toBe(false)
  })
})

describe('filterTasks — overdue dimension', () => {
  const overdueTasks: Task[] = [
    task({ id: 'o1', title: 'Past active', dueDate: PAST_ISO, status: 'IN_PROGRESS' }),
    task({ id: 'o2', title: 'Past done', dueDate: PAST_ISO, status: 'DONE' }),
    task({ id: 'o3', title: 'Future active', dueDate: FUTURE_ISO, status: 'BACKLOG' }),
    task({ id: 'o4', title: 'No due date', dueDate: undefined, status: 'BACKLOG' }),
    task({ id: 'o5', title: 'Past backlog', dueDate: PAST_ISO, status: 'BACKLOG' }),
  ]

  test('overdue-only keeps past-due active tasks, excludes DONE and no-due-date', () => {
    expect(ids(filterTasks(overdueTasks, filter({ overdue: true })))).toEqual(['o1', 'o5'])
  })

  test('overdue combines with other dimensions (AND)', () => {
    // Only o1 is IN_PROGRESS among the overdue set.
    const result = filterTasks(overdueTasks, filter({ overdue: true, text: 'past active' }))
    expect(ids(result)).toEqual(['o1'])
  })

  test('inactive overdue flag imposes no constraint (same reference)', () => {
    const result = filterTasks(overdueTasks, filter({ overdue: false }))
    expect(result).toBe(overdueTasks)
  })
})

// ---------------------------------------------------------------------------
// filterTasks
// ---------------------------------------------------------------------------

describe('filterTasks', () => {
  test('empty filter returns all tasks (same reference)', () => {
    const result = filterTasks(tasks, emptyBoardFilter)
    expect(result).toBe(tasks)
    expect(result).toHaveLength(5)
  })

  test('filters by text over title', () => {
    expect(ids(filterTasks(tasks, filter({ text: 'login' })))).toEqual(['t1'])
  })

  test('filters by text over description', () => {
    expect(ids(filterTasks(tasks, filter({ text: 'reference' })))).toEqual(['t2'])
  })

  test('text match is case-insensitive', () => {
    expect(ids(filterTasks(tasks, filter({ text: 'AUTH' })))).toEqual(['t1', 't4'])
  })

  test('text match trims surrounding whitespace', () => {
    expect(ids(filterTasks(tasks, filter({ text: '  docs  ' })))).toEqual(['t2'])
  })

  test('task with no description still matches on title', () => {
    expect(ids(filterTasks(tasks, filter({ text: 'refactor' })))).toEqual(['t4'])
  })

  test('filters by agent (exact id)', () => {
    expect(ids(filterTasks(tasks, filter({ agentId: 'a1' })))).toEqual(['t1', 't3'])
  })

  test('agent filter excludes unassigned tasks', () => {
    const result = filterTasks(tasks, filter({ agentId: 'a2' }))
    expect(ids(result)).toEqual(['t2', 't5'])
    expect(result.some((t) => t.agent === null)).toBe(false)
  })

  test('filters by priority (exact)', () => {
    expect(ids(filterTasks(tasks, filter({ priority: 'HIGH' })))).toEqual(['t1', 't4'])
  })

  test('filters by tag (exact)', () => {
    expect(ids(filterTasks(tasks, filter({ tag: 'backend' })))).toEqual(['t1', 't4'])
  })

  test('combines dimensions with AND semantics', () => {
    // HIGH priority AND backend tag AND agent Alice -> only t1
    const result = filterTasks(tasks, filter({ priority: 'HIGH', tag: 'backend', agentId: 'a1' }))
    expect(ids(result)).toEqual(['t1'])
  })

  test('combination that matches nothing returns empty', () => {
    // text "docs" only matches t2, but t2 is LOW priority, not HIGH
    expect(filterTasks(tasks, filter({ text: 'docs', priority: 'HIGH' }))).toHaveLength(0)
  })

  test('text + agent combination', () => {
    // "auth" matches t1 (Alice) and t4 (unassigned); agent Alice narrows to t1
    expect(ids(filterTasks(tasks, filter({ text: 'auth', agentId: 'a1' })))).toEqual(['t1'])
  })

  test('whitespace-only text imposes no constraint', () => {
    expect(filterTasks(tasks, filter({ text: '   ' }))).toHaveLength(5)
  })
})
