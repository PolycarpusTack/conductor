# Ops Layer Epic 6: Evidence Packets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every step execution can answer "what did this agent rely on?" with one inspectable packet: retrieval context, tool calls, artifacts, sessions, messages, step events, and safety flags — bound to the execution. The differentiator epic: terminal dashboards show output; Conductor binds output to its provenance.

**Architecture:** Nearly everything is already persisted relationally (ToolCallTrace by execution, StepArtifact + StepEvent + AgentSession by step, AgentMessage by task/step) — so the packet is **assembled on read**, not duplicated into a blob. The one ephemeral piece is retrieval context: which memories were injected into the prompt exists only inside `dispatchStep`. A new `StepExecution.evidence` JSON column captures exactly that at dispatch time (`memoryHits: [{id, category}]`, `workingMemory: boolean`). `evidence.ts` assembles the full packet; `GET /api/tasks/[id]/steps/[stepId]/evidence` serves it (admin); the step viewer gains an on-demand Evidence view.

**Context (verified):** `searchMemories` already returns structured `MemoryHit`s — `buildRelevantMemory` formats them away; a `WithHits` variant preserves them. Dispatch has no skill retrieval (design's `skillHits` doesn't apply — deviation). Daemon-path executions don't exist as rows (daemon steps skip `createExecution`), so daemon evidence rides on step-level links (events carry sessionId from Epic 3).

**Tech Stack:** Prisma 7, Next.js 16 App Router, TypeScript 5, Bun test

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - Assembled-on-read instead of the design's stored-blob approach — everything except retrieval context already lives relationally, and a stored packet would go stale as messages/events arrive after execution. Only the ephemeral piece (memory hits) is persisted, on `StepExecution.evidence`.
> - The Evidence toggle's label doesn't show counts (would require eager-fetching every step's packet); counts appear inside the expanded view instead.
> - `skillHits` omitted — dispatch performs no skill retrieval today.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | `StepExecution.evidence String?` |
| `src/lib/server/memory.ts` | `buildRelevantMemoryWithHits` (existing fn delegates) |
| `src/lib/server/dispatch.ts` | Capture memory hits into `execution.evidence` |
| `src/lib/server/evidence.ts` | New — `assembleStepEvidence(taskId, stepId)` |
| `src/lib/server/__tests__/evidence.test.ts` | New |
| `src/app/api/tasks/[id]/steps/[stepId]/evidence/route.ts` | New — GET (admin) |
| `src/components/step-output-viewer.tsx` | Evidence toggle per step |

---

### Task 1: Capture retrieval evidence at dispatch
- [x] `StepExecution.evidence String?` column; push + generate.
- [x] `buildRelevantMemoryWithHits(opts)` → `{ text, hits: Array<{id, category}> }`; `buildRelevantMemory` delegates (unchanged API for other callers/tests).
- [x] In `dispatchStep`: use the WithHits variant; after `createExecution`, persist `evidence` JSON `{ memoryHits, workingMemory: workingMemory.length > 0 }` (best-effort — failure must not block dispatch).
- [x] Memory tests still green; commit.

### Task 2: Evidence assembler (TDD)
- [x] `assembleStepEvidence(taskId, stepId)` queries in parallel: executions (with parsed `evidence` + toolCalls), artifacts, step events (parsed data), sessions, task/step messages (with parsed `bodySecurity`).
- [x] Derives: `sessionIds` (from sessions + event data), `safetyFlags` (from message security verdicts), per-execution `memoryHits`.
- [x] Returns null when the step doesn't belong to the task (scoping).
- [x] Tests with mocked db (full-surface factory).
- [x] Commit.

### Task 3: API + UI
- [x] `GET /api/tasks/[id]/steps/[stepId]/evidence` — admin session; 404 unknown/foreign step.
- [x] Step viewer: "Evidence" toggle beside execution history; fetches once; renders compact groups (memory hits, tool calls with durations, sessions, messages, safety flags) — counts in the toggle label.
- [x] Endpoint auth test (401/200/404).
- [x] Commit.

### Task 4: Wrap-up
- [x] Full verification; checkboxes; deviations; commit.

## Out of scope
- `skillHits` — dispatch performs no skill retrieval today; add when it does.
- Review-gate "evidence required" enforcement — display-only this epic; gate policy belongs with review-logic changes.
- Evidence for daemon executions as execution rows — daemon path has no StepExecution rows; step-level links (events/sessions/messages) still appear in the packet.
