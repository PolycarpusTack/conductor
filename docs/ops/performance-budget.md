# Board performance budget (G-4)

**Target:** a 500-task board stays interactive — a single user interaction
(filter keystroke, card selection, drag, live-agent event, task update) costs
**< 16 ms** of main-thread work (one 60 fps frame).

This document records what is measured automatically, what still needs a real
browser, and the memoization boundaries that hold the budget.

---

## What is verified in CI (algorithmic / unit)

`src/app/_views/__tests__/board-perf.test.ts` is the regression guard. It has no
browser, so it verifies the **algorithmic shape** of the hot path, not paint ms:

- **Reference identity.** `filterTasks` returns the *same array reference* when
  the filter is inactive (empty or whitespace-only text). This is load-bearing:
  it keeps `BoardPage.tasksByStatus`, `itemIdsByStatus`, and every card's props
  referentially stable, so an unrelated re-render does zero card work.
- **Object identity under an active filter.** A populated filter returns a new
  (subset) array, but the kept elements are the *same task objects* — so
  memoized cards that survive the filter bail instead of re-rendering.
- **Grouping is O(n), not O(n²).** The per-column grouping BoardPage runs
  (mirrored as `groupByStatus` in the test) is asserted linear via a *scaling
  ratio*: 10× the tasks costs well under 40× the time (a quadratic pass would be
  ~100×). Ratio checks, not wall-clock thresholds, so the assertion isn't flaky.
- **Pipeline budget.** 1000 iterations of `filter → group → tag-derive` over 500
  tasks complete comfortably inside a generous ceiling.

### Observed locally (Bun, dev machine — indicative, not asserted)

| Measurement | Result |
|---|---|
| `groupByStatus` scaling ratio (1000 tasks / 100 tasks) | ~6.7× (linear; quadratic would be ~100×) |
| `filterTasks` over 500 tasks | ~0.15 ms / call |
| full `filter → group → tag-derive` over 500 tasks | ~0.16 ms / pass |

Pure-JS cost of one filter keystroke over 500 tasks is therefore **~0.24 ms**
(one filter + one group), leaving the entire 16 ms frame to React
reconciliation and paint.

---

## Render-path analysis (500 tasks)

The board render path (`src/app/(board)/board/page.tsx`,
`src/components/board-task-card.tsx`, `src/app/_views/use-filtered-tasks.ts`) was
traced per interaction. All derived values are `O(n)` and memoized; there is **no
`O(n²)`** anywhere on the path.

| Interaction | Recomputes | Re-renders |
|---|---|---|
| **Initial render** | `filterTasks` (bails, same ref), `filterTags` O(n), `tasksByStatus` O(n)+sort, `itemIdsByStatus` O(n) — each once | 500 card mounts (inherent) |
| **Filter keystroke** | `filterTasks` O(n) (new subset), `tasksByStatus`/`itemIdsByStatus` O(n). `filterTags` **cached** (dep `allTasks` unchanged) | only added/removed cards; survivors bail (same task object + stable props) |
| **Select one card** | nothing tasks-related — `filteredTasks`/`tasksByStatus`/`itemIdsByStatus` all **same reference**. Parent does O(n) `selectedIds.has()` prop reads | exactly **one** card (its `selected` boolean flipped); all others bail |
| **One live-agent event** | `BoardPage` does **not** re-render (doesn't subscribe to live-logs). Each mounted `CardActivityTail` (in-progress cards only) filters the capped log | only the tail whose slice changed touches the DOM — `ActivityTail` is memoized with an element-wise comparator (E-5) |
| **One task-updated WS event** | new `tasks` array → `filterTasks`/`tasksByStatus`/`filterTags` recompute O(n). WS handler preserves identity of unchanged tasks (`tasks.map(t => t.id===id ? next : t)`) | only the changed card re-renders; others bail |

### Memoization boundaries that hold the budget

- **E-5** — `BoardTaskCard`, `SortableTaskCard`, `ActivityTail` are `memo`-wrapped;
  live-logs are isolated to a leaf `CardActivityTail` so log spam never
  re-renders the board/columns/card bodies; `tasksByStatus` groups once per
  tasks-change instead of five `getTasksByStatus` passes.
- **D-1** — `filterTasks` same-reference-when-inactive (verified here).
- **Card props** — colors are module constants; every card callback is a
  `useState` setter or a `useCallback` with stable deps (verified: `onOpen`,
  `onViewSteps`, `onEdit`, `onDelete`, `onToggleSelect`), so `memo` holds.
- **G-4 fix** — `itemIdsByStatus`: the `SortableContext items` id arrays are now
  memoized on `tasksByStatus` instead of a fresh `tasks.map(t => t.id)` per
  render, so re-renders that don't touch tasks (e.g. selection) hand
  `SortableContext` a stable array and its internal same-items check bails.

### Known bounded cost (not a regression)

On a live-agent event, every in-progress card's `CardActivityTail` filters the
whole live-log (capped at ~500 entries). Cost is `O(in-progress cards × log
size)` per event, but DOM work is `O(1)` because `ActivityTail` bails on an
equal slice. This is E-5's deliberate isolated-leaf design; it is bounded and
was left intact.

---

## What still needs a real browser (not in CI)

The unit path cannot measure actual paint, layout, or input latency. Verify
those manually with the **React DevTools Profiler**:

1. Seed a project with ~500 tasks (demo seed or a script) and open `/board`.
2. Open React DevTools → **Profiler** tab → gear → enable *"Record why each
   component rendered"*.
3. Click **Record**, perform one interaction, click **Stop**:
   - **Filter keystroke:** type one character in the board search. Expect only
     added/removed cards to appear in the flamegraph; surviving cards show
     "Did not render". Commit duration should be a few ms, not tens.
   - **Select a card:** toggle one card's checkbox. Expect exactly one
     `BoardTaskCard` committed; the rest grey ("bailed out").
   - **Live-agent event:** with an in-progress task streaming, expect only
     `CardActivityTail`/`ActivityTail` for the active task to commit.
4. In the **Performance** tab, record the same interactions and confirm no long
   task > 16 ms (no dropped frame). Use CPU throttling (4–6×) to simulate a
   slower client.

If a Profiler run shows *all* cards re-rendering on a single-card selection or a
filter keystroke, a prop stability boundary above has regressed — check for a
new inline object/callback prop on `BoardTaskCard` or a broken `filterTasks`
same-reference guarantee.
