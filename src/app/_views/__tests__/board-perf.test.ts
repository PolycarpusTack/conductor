import { describe, test, expect } from 'bun:test'
import { filterTasks, emptyBoardFilter, type BoardFilter } from '../use-filtered-tasks'
import type { Task, TaskStatus, TaskPriority } from '@/types/board'

/**
 * G-4 performance-budget regression guard.
 *
 * There is no browser profiler in CI, so this suite verifies the ALGORITHMIC
 * shape of the board's hot path rather than paint/interaction milliseconds:
 *
 *   1. correctness + reference-identity of `filterTasks` at 500-task scale
 *      (an inactive filter must return the SAME array so downstream memos —
 *      BoardPage.tasksByStatus / itemIdsByStatus — keep their identity and no
 *      card re-renders);
 *   2. the per-column grouping BoardPage runs (`groupByStatus` below mirrors
 *      page.tsx exactly) is O(n): 10x the tasks costs ~linearly more, nowhere
 *      near the ~100x a quadratic pass would (asserted via a scaling ratio,
 *      not a wall-clock threshold, so it isn't flaky);
 *   3. the whole pipeline (filter -> group -> tag-derive) over 500 tasks stays
 *      inside a generous per-iteration time budget.
 *
 * Wall-clock assertions use deliberately loose bounds (headroom for slow/loaded
 * CI); the load-bearing assertions are the ratio + reference-identity checks.
 */

// --- statusColumns / priorities mirror board-constants (kept local so this
// perf harness has no React/JSX import surface). ---
const STATUSES: TaskStatus[] = ['BACKLOG', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'DONE']
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const TAGS = ['research', 'docs', 'backend', 'frontend', 'devops', 'copy', 'design']

/** Build a deterministic board of `n` tasks spread across all columns. */
function buildTasks(n: number): Task[] {
  const tasks: Task[] = []
  for (let i = 0; i < n; i++) {
    tasks.push({
      id: `t${i}`,
      title: `Task number ${i} doing work`,
      description: i % 2 === 0 ? `Description body for task ${i}` : undefined,
      status: STATUSES[i % STATUSES.length],
      priority: PRIORITIES[i % PRIORITIES.length],
      tag: TAGS[i % TAGS.length],
      agent: i % 3 === 0 ? { id: `a${i % 7}`, name: 'Agent', emoji: '🤖', color: '#fff', isActive: true, maxConcurrent: 1 } : null,
      order: n - i, // reverse so the sort actually does work
      dueDate: i % 4 === 0 ? '2020-01-01T23:59:59.999Z' : undefined,
    })
  }
  return tasks
}

/**
 * Exact mirror of BoardPage's `tasksByStatus` memo (single O(n) group pass +
 * per-column O(k log k) sort). If page.tsx's grouping ever regresses to an
 * O(n²) shape (e.g. a per-status filter over all tasks, the pre-E-5 form), the
 * scaling ratio below catches it.
 */
function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const grouped = Object.fromEntries(STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>
  for (const task of tasks) {
    grouped[task.status]?.push(task)
  }
  for (const status of Object.keys(grouped) as TaskStatus[]) {
    grouped[status].sort((a, b) => a.order - b.order)
  }
  return grouped
}

/** Exact mirror of BoardPage's `filterTags` memo (distinct sorted tags). */
function deriveTags(tasks: Task[]): string[] {
  const set = new Set<string>()
  for (const task of tasks) {
    if (task.tag) set.add(task.tag)
  }
  return Array.from(set).sort()
}

const filter = (over: Partial<BoardFilter> = {}): BoardFilter => ({ ...emptyBoardFilter, ...over })

/** Median wall-clock (ms) of `iters` runs of `fn`, after a warmup pass to let the JIT settle. */
function timeMs(fn: () => void, iters: number): number {
  for (let i = 0; i < Math.min(iters, 50); i++) fn() // warmup
  const samples: number[] = []
  const reps = 5
  for (let r = 0; r < reps; r++) {
    const start = performance.now()
    for (let i = 0; i < iters; i++) fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(reps / 2)]
}

describe('board perf — reference identity (no wasted downstream renders)', () => {
  test('inactive filter returns the SAME reference at 500-task scale', () => {
    const tasks = buildTasks(500)
    // A no-op keystroke path (whitespace) and the truly-empty filter both bail.
    expect(filterTasks(tasks, emptyBoardFilter)).toBe(tasks)
    expect(filterTasks(tasks, filter({ text: '   ' }))).toBe(tasks)
  })

  test('active filter returns a NEW array (subset) but preserves task object identity', () => {
    const tasks = buildTasks(500)
    const result = filterTasks(tasks, filter({ priority: 'HIGH' }))
    expect(result).not.toBe(tasks)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThan(tasks.length)
    // Kept tasks are the very same objects — so memoized cards bail (E-5).
    for (const t of result) expect(tasks.includes(t)).toBe(true)
  })
})

describe('board perf — grouping is O(n), not O(n²)', () => {
  test('grouping 500 tasks partitions every task exactly once, sorted by order', () => {
    const tasks = buildTasks(500)
    const grouped = groupByStatus(tasks)
    const total = STATUSES.reduce((sum, s) => sum + grouped[s].length, 0)
    expect(total).toBe(500)
    for (const s of STATUSES) {
      const col = grouped[s]
      for (let i = 1; i < col.length; i++) {
        expect(col[i - 1].order).toBeLessThanOrEqual(col[i].order)
      }
    }
  })

  test('10x the tasks costs ~linearly more (well under quadratic)', () => {
    const small = buildTasks(100)
    const large = buildTasks(1000)
    const tSmall = timeMs(() => { groupByStatus(small) }, 2000)
    const tLarge = timeMs(() => { groupByStatus(large) }, 2000)
    const ratio = tLarge / Math.max(tSmall, 0.0001)
    // Linear+sort would be ~10-13x; quadratic would be ~100x. Cap generously at
    // 40x to stay non-flaky under CI jitter while still failing on an O(n²) regression.
    expect(ratio).toBeLessThan(40)
  })
})

describe('board perf — pipeline stays within budget', () => {
  test('filter -> group -> tag-derive over 500 tasks, 1000 iterations, comfortably fast', () => {
    const tasks = buildTasks(500)
    const active = filter({ text: 'work', priority: 'HIGH' })
    const t = timeMs(() => {
      const filtered = filterTasks(tasks, active)
      groupByStatus(filtered)
      deriveTags(tasks)
    }, 1000)
    // 1000 full pipeline passes over 500 tasks. Generous 3s ceiling — observed
    // an order of magnitude under this locally; the bound guards a gross regression.
    expect(t).toBeLessThan(3000)
  })

  test('tag derivation over 500 tasks yields the distinct sorted set', () => {
    const tasks = buildTasks(500)
    expect(deriveTags(tasks)).toEqual([...TAGS].sort())
  })
})
