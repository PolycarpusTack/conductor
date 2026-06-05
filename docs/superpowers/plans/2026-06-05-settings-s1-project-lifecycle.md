# Settings Epic S1: Project Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The General tab grows up: project defaults (step mode + chain template) that task creation actually consumes, artifact retention with lazy purge, and a type-the-name delete-project flow. Closes the highest-value items from the settings-completion roadmap.

**Architecture:** Three additive `Project` columns (`defaultStepMode`, `defaultChainTemplateId`, `artifactRetentionDays`). Consumption: (1) a task created **with an agent but no steps and no explicit status** auto-creates a single step in the default mode and dispatches — this also fixes a long-standing help-vs-behavior gap where assignment claimed to dispatch but stepless tasks never ran; (2) the task dialog prefills its step builder from the default chain template on fresh opens (client-side, non-surprising). Retention follows the activity-log pattern: lazy purge (`purgeProjectArtifacts`) fired alongside `purgeProjectLogs` from the activity GET. Delete-project uses the existing `DELETE /api/projects/[id]` behind a type-the-name confirmation; BoardView switches to the first surviving project.

**Context (verified):** `updateProjectSchema` extends create + `logRetentionDays`; tasks POST auto-starts chains only when `steps[]` present (`effectiveStatus` at route line ~122, `startChain` at ~282); `TaskDialog` already receives `currentProject` + `chainTemplates`; `purgeProjectLogs` fire-and-forget precedent in activity GET; `DELETE /api/projects/[id]` exists (admin + CSRF).

**Tech Stack:** Prisma 7, Next.js 16, TypeScript 5, Zod 4, Bun test

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Project.defaultStepMode/defaultChainTemplateId/artifactRetentionDays` |
| `src/lib/server/contracts.ts` | Extend `updateProjectSchema` |
| `src/app/api/projects/[id]/route.ts` | GET returns + PUT accepts the new fields |
| `src/app/api/tasks/route.ts` | Auto-step for agent-assigned stepless tasks |
| `src/lib/server/retention.ts` | New — `purgeProjectArtifacts` |
| `src/lib/server/__tests__/retention.test.ts` | New |
| `src/app/api/activity/route.ts` | Fire artifact purge lazily |
| `src/components/settings-dialog.tsx` | General tab: defaults selects, retention, danger zone |
| `src/components/task-dialog.tsx` | Prefill steps from default chain template |
| `src/app/_views/BoardView.tsx` | `onProjectDeleted` wiring |
| `src/types/board.ts` | Project gains the new optional fields |
| `src/lib/server/__tests__/tasks-route.test.ts` | Auto-step cases |
| help Settings·General | Mark S1 shipped |

---

### Task 1: Schema + contracts + project routes
- [ ] Columns; push + generate. `updateProjectSchema` + PUT route data/select; GET select returns the new fields. `types/board.ts` Project extends.
- [ ] Commit.

### Task 2: Defaults consumption
- [ ] tasks POST: fetch project defaults; when `agentId && !steps?.length && !status` → synthesize `steps = [{ mode: defaultStepMode ?? 'develop', agentId, autoContinue: true }]` before the existing pipeline (auto-start then applies naturally).
- [ ] Route tests: agent-only task → step created with default mode, status IN_PROGRESS, startChain fired; explicit `status: 'BACKLOG'` opts out; project without default uses `develop`.
- [ ] TaskDialog: on fresh open with empty steps, prefill from `currentProject.defaultChainTemplateId`.
- [ ] Commit.

### Task 3: Artifact retention
- [ ] `purgeProjectArtifacts(projectId)`: no-op unless `artifactRetentionDays` set; deletes `StepArtifact` rows older than cutoff belonging to DONE tasks of the project; returns count. Unit tests (null retention no-op, cutoff math, DONE-only scoping).
- [ ] Lazy fire in activity GET next to `purgeProjectLogs`.
- [ ] Commit.

### Task 4: Danger zone + settings UI
- [ ] General tab: Defaults card (mode select from `projectModes`, chain template select from `chainTemplates`, artifact retention select) saving through the same PUT; Danger zone card — type the project name to enable <em>Delete project</em>; on success `onProjectDeleted()`.
- [ ] BoardView: `onProjectDeleted` → switch to first other project (`switchProject`) or clear board state.
- [ ] Commit.

### Task 5: Wrap-up
- [ ] Help Settings·General updated (S1 shipped; roadmap callout slims to leftovers if any); roadmap doc S1 marked shipped; full verification; commit.

## Out of scope
- Step-execution retention (audit rows) — revisit with real disk pressure.
- Workspace-level defaults.
