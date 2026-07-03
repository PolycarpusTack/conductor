# Phase Summary — EPIC E (Frontend Architecture Refactor)

Date: 2026-07-03. Commits `778fcc6..9cf9768` (8 story commits + 1 decision commit).

## What was built

- **E-3 grouped contexts** (778fcc6): BoardView 117 props → 0; SettingsDialog 39 → 0; six memoized context groups with `liveAgentLogs` isolated for E-5. Foundation for the whole EPIC.
- **E-2a typed API client** (c0a1c33): `src/lib/api/`; four hooks 25 raw fetches → 0, behavior preserved exactly.
- **E-6 settings IA** (9a04603): 12 flat tabs → 4 grouped nav sections; 11 native confirm()/alert() → AlertDialog + toasts.
- **E-8 dep cleanup** (074808d): removed 17 unused deps (incl. next-intl, zustand per A4) + 7 orphaned ui files; op-* token drift fixed across 8 components; −1,889 lines.
- **E-1 URL routing** (cd57def): app/(board) route group with a shared BoardShell; /help server-rendered; landing bundle −64%, board −12%; task deep-links; back/forward.
- **E-7 mobile authoring** (a35b026): sidebar as a slide-over Sheet below md — Create Agent/Wizard/Chain + agent list now reachable on phones.
- **E-4 dnd-kit** (26423f6): keyboard-accessible drag (grip handle, arrows, announcements, DragOverlay); native HTML5 drag removed; C-2 optimistic move preserved.
- **E-5 memoization** (9cf9768): live-agent events re-render one card, not the whole board; cards + ActivityTail memoized; per-column slices memoized.

## What was DEFERRED

- **E-2b TanStack Query** — owner decision (daa0d22), tracked TD-023. After E-2a + E-3 the remaining payoff (cache invalidation) is largely covered; full adoption would rewrite the central currentProject state and duplicate working WS reconciliation. react-query stays installed pending a revisit-or-drop.

## What was learned

- The unused-stack finding from the brownfield review resolved cleanly: next-intl/zustand removed, dnd-kit/react-query kept and (dnd-kit) actually adopted — the drift is now either used or gone.
- E-3-first was the right sequencing call: contexts shrank every subsequent diff and pre-isolated the live-logs subscription that made E-5 a leaf-level change rather than a board-wide rework.
- Real routes (Shape A) beat URL-synced SPA: server-rendering the 3,424-line help page off the client bundle was the single biggest bundle win and fell out of the routing change for free.

## Plan deviations

- E-2b dropped (above). E-2 split into E-2a (done) + E-2b (deferred) at refinement, as the plan anticipated.
- E-4 retained an unused `handleDragOver` in useTaskManager because the context type is a locked shape (packaged by board-shell); only its native call sites were removed.
- E-7 did not add a "Create Task" button to the mobile sidebar — task creation lives on the board canvas (E-4 territory); mirrored exactly what the desktop sidebar offers.

## Incident (recovered)

- E-4's temp-worktree cleanup deleted through a node_modules junction and wiped the shared node_modules; reinstalled + rebuilt better-sqlite3 (Python 3.12 distutils gap fixed via setuptools<81). Verified healthy: native module loads, 725 tests, build green. Lesson recorded: never junction node_modules into a temp worktree; wait out the next-build lock instead.

## Debt register (new this EPIC)

TD-022 (agent-memory-panel sonner toasts unmounted), TD-023 (deferred query migration). Still open from A/B: TD-018-remainder (daemon StepExecution rows), ADR-1..5 unwritten.

## Retro (flow)

- 8 stories via parallel agents; file-ownership partitioning held — zero merge conflicts across the whole EPIC despite up to 4 concurrent agents on the frontend.
- Sequencing discipline paid off: E-3 solo → wide parallel middle → E-4/E-5 serialized on the board cards. The only friction was the node_modules incident (environmental, not a code conflict).
- Rework rate: 0 stories reworked; 1 parent-side scope call (defer E-2b).
- Suite steady at 725 tests green; production build green throughout; landing bundle 1,754 → 623 KB.
- Next: EPIC D (product completeness) now safe to build on the refactored board; then F (ops/ADRs) and G (hardening/1.0).
