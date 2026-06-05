# Settings Epic S3: Soft-Delete & Activity Ergonomics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleted tasks get a 30-day grace period with one-click restore, and the activity log gains a date-range filter. The help once *claimed* soft-delete existed; now it will.

**Architecture:** `Task.deletedAt DateTime?`. `DELETE /api/tasks/[id]` flips to a soft delete (sets `deletedAt`, releases step leases). Every live read/dispatch path filters `deletedAt: null`: project board fetch, tasks list, the two `pollAndDispatch` step queries, and the agent-facing next/list endpoints. Restore = `POST /api/tasks/[id]/restore` (admin + CSRF). Hard purge after 30 days rides the existing lazy-retention pattern (`purgeDeletedTasks` next to the artifact purge). UI: a "Recently deleted" strip in Settings → Activity with Restore buttons, plus from/to date inputs feeding both the list query and export.

**Context (verified):** task DELETE currently hard-deletes (`db.task.delete`); board tasks come from `projects/[id]` GET include; dispatch eligibility from `step-queue.ts` queries; activity GET parses `activityQuerySchema` (no date range) while the export route already accepts from/to.

**Tech Stack:** Prisma 7, Next.js 16, TypeScript 5, Zod 4, Bun test

---

### Task 1: Schema + soft-delete + filters
- [x] `Task.deletedAt DateTime?` (+ index `[projectId, deletedAt]`); push + generate.
- [x] DELETE route: `update { deletedAt: now }` + release step leases (`leasedBy/leasedAt` null on its steps); keep the `task-deleted` broadcast.
- [x] `deletedAt: null` filters: projects/[id] GET tasks include; tasks GET list; both `pollAndDispatch` step queries (`task: { deletedAt: null }`); `/api/agent/next`; `/api/agent/tasks`; `/api/cli` GET.
- [x] Commit.

### Task 2: Restore + purge + endpoints
- [x] `POST /api/tasks/[id]/restore` — admin + CSRF; 404 unknown; clears `deletedAt`; broadcasts `task-created` so boards refetch.
- [x] `GET /api/projects/[id]/deleted-tasks` — admin; last 50 deleted with title/deletedAt.
- [x] `purgeDeletedTasks(projectId)` in retention.ts — hard-deletes (cascade) tasks `deletedAt < now-30d`; fired lazily from activity GET. Tests.
- [x] Endpoint tests (auth, restore flow).
- [x] Commit.

### Task 3: UI + date-range filter
- [x] settings-activity: "Recently deleted tasks" section (renders when non-empty) with Restore buttons; from/to date inputs wired into the activity query + export links.
- [x] `activityQuerySchema` gains optional from/to; activity GET applies `createdAt gte/lte`.
- [x] Commit.

### Task 4: Wrap-up
- [x] Help (task Delete section + Activity tour + roadmap callout) updated to shipped reality; roadmap S3 marked; full verification; commit.

## Out of scope
- Soft-delete for agents/projects (different blast radii; separate decisions).
- Restoring a task whose agents were since deleted (restores fine; steps with missing agents simply won't dispatch).
