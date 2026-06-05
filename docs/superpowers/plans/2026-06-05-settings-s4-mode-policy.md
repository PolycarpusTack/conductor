# Settings Epic S4: Mode Policy Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modes become the policy object the help always described: per-mode max attempts (feeding step defaults), a per-mode tool allowlist layered on the built-in heuristics, and an output-format hint appended to prompts.

**Architecture:** Three `ProjectMode` columns: `maxAttempts Int?`, `toolAllowlist String?` (JSON string[], supports exact namespaced names and `prefix*` globs; null = no restriction), `outputFormat String?` (markdown/json/diff/plain). Consumption: (1) step creation (`/api/tasks` POST and `/api/tasks/[id]/steps` POST) resolves `maxRetries` as `step value → mode maxAttempts → 2`; (2) `resolveMcpTools` gains an optional `toolAllowlist` param applied AFTER the built-in mode heuristics (the layers compose: heuristic strips writes in read-only modes, allowlist narrows further) — dispatch passes the already-fetched `projectMode`'s parsed list; (3) dispatch appends `outputFormat` as a one-line instruction to the mode-instruction layer. UI: settings-modes gains the three fields.

**Context (verified):** `MODE_TOOL_FILTERS` heuristics in `mcp-resolver.ts` filter namespaced names; dispatch fetches `projectMode` before tool resolution; step creation hardcodes `maxRetries: step.maxRetries ?? 2` in both routes; `settings-modes` is name/label/color/icon/instructions CRUD.

**Tech Stack:** Prisma 7, Next.js 16, TypeScript 5, Bun test

---

### Task 1: Schema + enforcement (TDD)
- [x] `ProjectMode`: `maxAttempts Int?`, `toolAllowlist String?`, `outputFormat String?`; push + generate; contracts (`projectModeSchema`/update) extended.
- [x] `resolveMcpTools(ids, mode, toolAllowlist?)`: glob-aware allowlist after heuristics. Tests: exact, `github.*`-style prefix glob (`conn__*`), null pass-through, composition with read-only heuristic.
- [x] Commit.

### Task 2: Consumption
- [x] Both step-creation routes resolve mode `maxAttempts` for `maxRetries` default (mode lookup map fetched once per request).
- [x] Dispatch: pass `projectMode.toolAllowlist` (parsed) into `resolveMcpTools`; append `outputFormat` hint line to mode instructions.
- [x] Route test: task created with a mode whose `maxAttempts=5` → steps get `maxRetries 5` unless explicitly set.
- [x] Commit.

### Task 3: UI + wrap-up
- [x] settings-modes: max-attempts number input, output-format select, tool-allowlist textarea (one pattern per line; blank = no restriction).
- [x] Help (Modes sections + S4 roadmap callouts) updated; roadmap S4 marked; full verification; commit.

> **Implemented 2026-06-05.** Deviations: none of substance. The allowlist filter
> lives in `resolveMcpTools` as a third parameter (layered after the
> MODE_TOOL_FILTERS heuristics) rather than a separate function; `matchesToolPattern`
> is exported for direct testing. The steps POST route resolves the mode's
> `maxAttempts` via a relation query (`project.tasks.some.id`) since the route only
> has the task ID. UI adds a compact policy summary line on each mode row.
