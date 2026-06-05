# Ops Layer Epic 3: Terminal-Backed Step Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daemon-mode steps can run inside declared local sessions. The runtime config gains a session policy (`ephemeral` / `persistent-agent` / `persistent-task` / `persistent-step`); `GET /api/daemon/steps/next` hands the daemon a ready-to-use session block (including a **server-computed sessionKey** so reuse semantics live in one place); step completion links the session; an in-repo reference daemon proves the whole protocol end-to-end.

**Architecture:** A pure `session-policy.ts` module parses `ProjectRuntime.config` JSON into a typed policy with safe defaults (`ephemeral`/`process`) and computes the session key from policy + step identity. `steps/next` resolves the policy from the step's agent runtime and embeds the session block; it also appends a `started` StepEvent (daemon parity with HTTP dispatch's audit trail — the daemon path currently writes **no** step events). `POST /api/daemon/steps` accepts an optional `sessionId`, verifies the daemon owns it, stamps the session's task/step linkage, and appends `succeeded`/`failed` StepEvents carrying the sessionId — that durable event is the step↔session evidence link Epic 6 will consume. The reference daemon (`mini-services/conductor-daemon/`, decision D6) registers with a host block + installation ID, heartbeats, polls, reports sessions/output through the Epic 2 APIs, executes via the policy's command template, and completes/fails steps.

**Context (verified against current code):** daemon leasing in `daemon-dispatch.ts` (`dispatchStepToDaemon` leases via `leasedBy`); `steps/next` selects `agent.runtime { adapter }` only — needs `config` + `agent.runtimeModel`; completion route `POST /api/daemon/steps` (complete/fail, no executions, no step events today); step event log + `appendStepEvent` from v0.0.6; session APIs from Epic 2; `runtimeFromProjectRuntime` maps adapter→daemon capability.

**Tech Stack:** TypeScript 5, Zod 4, Bun (daemon runtime), Next.js 16 App Router, Bun test

---

## File Map

| File | Change |
|---|---|
| `src/lib/server/session-policy.ts` | New — parse runtime config → typed policy; sessionKey + command resolution |
| `src/lib/server/__tests__/session-policy.test.ts` | New — defaults, parsing, key computation, template resolution |
| `src/app/api/daemon/steps/next/route.ts` | Include `session` block; append `started` StepEvent |
| `src/app/api/daemon/steps/route.ts` | Accept `sessionId` (ownership-checked); append `succeeded`/`failed` StepEvents |
| `src/lib/server/__tests__/daemon-steps-route.test.ts` | New — sessionId ownership + event emission tests |
| `mini-services/conductor-daemon/index.ts` | New — reference daemon (register, heartbeat, poll, sessions, execute, complete) |
| `mini-services/conductor-daemon/package.json` + `README.md` | New — bun-runnable, documented |

---

### Task 1: Session policy module (TDD)

- [ ] **Step 1: Failing tests** for `src/lib/server/session-policy.ts`:
  - `parseSessionPolicy(null)` → defaults `{ sessionPolicy: 'ephemeral', sessionBackend: 'process', idleRequiredBeforeCommand: false, maxOutputPreviewChars: 5000 }`
  - parses a full config JSON; unknown values fall back to defaults (never throw)
  - `sessionKeyForStep(policy, ids)`: ephemeral→`step-{stepId}`, persistent-agent→`agent-{agentId}`, persistent-task→`task-{taskId}`, persistent-step→`step-{stepId}`; persistent-agent without agentId falls back to step key
  - `resolveCommandTemplate(template, vars)` substitutes `{{agent.runtimeModel}}`-style tokens, leaves unknown tokens empty
- [ ] **Step 2:** Implement (pure, no DB). Zod-validate the config shape leniently (`.catch()` semantics — bad config degrades to defaults, logged once).
- [ ] **Step 3:** Tests green; commit.

---

### Task 2: steps/next session block + started event

- [ ] **Step 1:** Extend the select with `agent.runtimeModel` and `agent.runtime { adapter, config }`; compute `policy = parseSessionPolicy(runtime.config)`; respond with
  `session: { policy, backend, sessionKey, command, workingDirectoryPolicy, idleRequiredBeforeCommand, maxOutputPreviewChars }` (command = resolved template or null).
- [ ] **Step 2:** Append `started` StepEvent `{ source: 'daemon', daemonId, attempt }` when a step is handed out (the daemon path's first audit-trail entry).
- [ ] **Step 3:** Commit.

---

### Task 3: Completion linkage + step events

- [ ] **Step 1:** `POST /api/daemon/steps` accepts optional `sessionId`. When present: 403 unless the session is owned by the calling daemon; stamp `session.taskId/stepId` if missing.
- [ ] **Step 2:** Append `succeeded` / `failed` StepEvents with `{ source: 'daemon', daemonId, sessionId?, willRetry? }` in the respective branches (`retry_scheduled` for willRetry).
- [ ] **Step 3:** Route tests: sessionId owned by another daemon → 403; complete with sessionId → event carries it; fail with willRetry → `retry_scheduled` + `failed` events.
- [ ] **Step 4:** Commit.

---

### Task 4: Reference daemon (`mini-services/conductor-daemon`)

- [ ] **Step 1:** `index.ts` — single-file bun daemon:
  - Config via env: `CONDUCTOR_URL`, `CONDUCTOR_DAEMON_TOKEN` (or `--register` flow printing a token once), `DAEMON_CAPABILITY` (default `claude-code`), poll interval.
  - Persists an installation ID in `~/.conductor-daemon/installation-id`.
  - Register (admin-token-assisted, one-time) → heartbeat loop (30s, with runningTasks/activeSessions) → poll `steps/next` (5s).
  - On step: upsert session (policy-derived key/backend from the response), spawn the resolved command (default safe echo runner when no commandTemplate configured), stream stdout/stderr chunks as session output events (bounded), report status transitions, then POST completion with `sessionId`.
  - Graceful shutdown: mark sessions exited.
- [ ] **Step 2:** `package.json` (no deps — bun built-ins only) + `README.md` documenting env vars, the register flow, and the **safety default** (without an explicit commandTemplate the daemon never executes step instructions as shell).
- [ ] **Step 3:** `bun build`-check the file compiles under the repo type-check (excluded from Next build; included in tsconfig? mini-services/board-ws precedent — match it).
- [ ] **Step 4:** Commit.

---

### Task 5: Wrap-up + v0.1.0 release

- [ ] **Step 1:** Full verification; mark checkboxes; deviations note.
- [ ] **Step 2:** Release v0.1.0 — Epics 1–3 are the "live operations" story (version bump, help page section, release commit).

## Out of scope

- Browser-initiated session input — never (design hard rule).
- `container` backend — schema supports it; reference daemon implements `process` only (pty/tmux need native deps; documented in README).
- Realtime socket UI for session output (broadcasts exist; UI still polls — revisit after the messaging epic's UI work).
