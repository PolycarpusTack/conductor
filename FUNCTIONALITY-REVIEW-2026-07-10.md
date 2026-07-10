# Conductor / AgentBoard — Functionality & Conceptual-Logic Review (2026-07-10)

> Companion to `GAP-ANALYSIS-2026-07-10.md`. That document catalogues implementation gaps; this one
> answers two different questions: **how does the application actually work, as experienced by its
> users — and is its conceptual model logical?** Implementation bugs are not re-reported here;
> several findings below are conceptual siblings of that document's findings and are new.

---

## PART 1 — How it actually works

### 1.1 Domain model (prisma/schema.prisma — 34 models)

**The spine (what a user cannot avoid):**

- **Project** — the real top-level unit in practice. Owns tasks, agents, modes, runtimes, MCP connections, templates, triggers, memories, automation config, budget, retention policies. 20+ owned relations.
- **Task** — a kanban card. `status ∈ {BACKLOG, IN_PROGRESS, WAITING, REVIEW, DONE}`, priority, optional `agentId`, `dueDate`, soft-delete, archive, `claimExpiresAt` (pull-agent liveness lease), `runtimeOverride`.
- **TaskStep** — a chain node: `order` (linear) plus optional DAG fields (`nextSteps`/`prevSteps` JSON, merge points), `mode`, `agentId`, `autoContinue`, its own status machine (`pending → active → done|failed|skipped`), retries/backoff/timeout, lease columns, `requiredSignOffs`, `fallbackAgentId`.
- **Agent** — a configuration record (the help calls it an "employee file"): identity, role, system prompt, `supportedModes`, per-mode `modeInstructions`, `runtimeId` + `runtimeModel`, `mcpConnectionIds`, `maxConcurrent`, API key (hashed), `isActive`, and `invocationMode ∈ {HTTP, DAEMON}`.
- **ProjectRuntime** — a credentialed connection to an LLM provider (adapter + models + `apiKeyEnvVar`). Agents point at one.
- **ProjectMode** — a named behavior profile per project (`analyze`, `verify`, `develop`, `review`, `draft`, `human` seeded by `default-modes.ts`), carrying instructions, `maxAttempts`, `toolAllowlist`, `outputFormat`.

**Execution bookkeeping:** StepExecution (attempts, tokens, cost), StepEvent (append-only audit), StepReview (sign-offs with supersession), StepArtifact, ToolCallTrace, DeadLetterStep (relation-free snapshot), Notification (relation-free inbox).

**Reuse/automation layer:** ChainTemplate (steps JSON), TaskTemplate (form defaults, optionally linked to a ChainTemplate), RecurringTask (instantiates a TaskTemplate on cadence), Trigger→Reaction (events/Sentry-poll → Slack/Jira/HTTP/email), project automation fields (`automationMode`, poll interval, sweeps).

**Knowledge layer:** AgentMemory (per agent+project; fact/decision/preference/pattern, embeddings), Skill (per *workspace*, versioned markdown), plus the env-configured prompt-library (filesystem, not a model at all).

**Infrastructure layer:** Workspace (container for Projects, Daemons, Skills, Hosts), Daemon, Host, AgentSession, SchedulerLock, AdminConfig, User/UserSession/PasswordResetToken, ApiKey (scoped integration keys), AgentAddress/AgentMessage (agent-to-agent mail).

**The irreducible mental model** a user must hold to use the product at all: *Projects contain Tasks; a Task is either a plain card or carries a chain of Steps; each Step pairs an Agent (who) with a Mode (how); Agents think through Runtimes; a poller dispatches active steps; `human` steps pause for approval.* That is already six interlocking concepts — and it excludes workspaces, skills, memories, triggers, templates, daemons, and the three key types, all of which the UI surfaces.

### 1.2 The human journey

1. **First run** — `bun install`, `bun run db:push`, `bun run dev`. Land on a marketing page (`LandingView.tsx`). Click through → auth gate. First login with `AGENTBOARD_ADMIN_PASSWORD` silently bootstraps an `owner@conductor.local` account (toast explains this). Covered by `e2e/first-run.spec.ts`.
2. **Create project** — header "+ New Project": name, description, color, "provision starter agents" checkbox. Empty state alternatively offers "Load Demo Data" (dev only). Project creation seeds the six default modes.
3. **Configure** — everything lives inside one large **Settings dialog** with ~12 tabs. For anything to actually execute, the user must (a) create a Runtime with an env-var-named API key, (b) create or import Agents bound to that runtime (creation modal or the LLM-powered Wizard, which itself needs `PROMPT_LIBRARY_PATH` + an LLM key), and (c) turn on automation (`automationMode`: manual/always/scheduled/startup — default **manual**, i.e. nothing dispatches).
4. **Create work** — one Task dialog does both jobs: title/priority/tag/agent/due-date, and optionally a multi-step chain inline (ChainBuilder, prefilled from a chain template or the project default). Server semantics (`api/tasks/route.ts`): steps present + no explicit status → task starts **IN_PROGRESS** and `startChain()` fires; agent picked but no steps → an **invisible single step** is auto-created in the project's `defaultStepMode` (default `develop`); plain task → BACKLOG.
5. **Watch execution** — board updates live via board-ws (if configured). Cards show chain progress; the drawer shows steps, attempts, artifacts, Approve/Reject on active human steps. Header: Live/Offline pill, budget chip, dead-letter chip, notification bell.
6. **Review gate** — a `human` step activates → task parks in **WAITING** (see 1.4), `review_gate_waiting` notification fires, reviewer approves (N-of-M sign-offs) → chain advances; reject/revision → `rewindChain` resets the previous agent step with feedback in `rejectionNote`, task returns to IN_PROGRESS.
7. **Done & aftermath** — all steps done → task auto-moves to DONE; retention sweeps can archive stale DONE tasks; analytics in Settings→Analytics + the Runtime dashboard (per-project only).

### 1.3 The agent journeys — there are actually **three**, not two

**(a) External pull agent ("Model B", HTTP/CLI API).** A script the *user* runs, authenticating with the agent's `ab_agent.…` key. `GET /api/agent/next` or `/api/cli` → claim (sets `claimExpiresAt`, task → IN_PROGRESS) → heartbeat via any call → `complete` (task → DONE if stepless), `review` (task → **REVIEW** — the only writer of that status), `progress`, `block`. Crash-safety: the 60s claim-reaper returns expired claims to BACKLOG. The agent initiates everything; Conductor is a passive task store.

**(b) Server-dispatched LLM agent ("Model A", `invocationMode: HTTP`).** The user does nothing at run time. The per-project poller (10s default) selects active, unleased steps whose agent has a runtime and `isActive: true`; `dispatch.ts` runs the whole ritual server-side: lease-first, attempt allocation, memory build, `resolvePrompt` token substitution, MCP tool resolution, adapter call with timeout, retry/backoff, fallback agent, dead-letter, `advanceChain`. The "agent" never runs anywhere — it is a prompt configuration executed inside the Next.js process.

**(c) Daemon agent (`invocationMode: DAEMON`).** The user runs `conductor-daemon` on a machine, registers it (admin cookie), gets a `cd_daemon.…` token, sets `DAEMON_WORKSPACE_ROOT` and `DAEMON_RUNNER=claude`. The poller leases the step to an online daemon in the project's workspace; the daemon **polls** `GET /api/daemon/steps/next`, spawns the CLI (prompt on stdin per ADR-0001), POSTs the result back. Server trusts daemon's `willRetry`; stale-daemon sweep reclaims leases in ~30s.

### 1.4 The board-vs-chain duality

Two state machines coexist: task `status` (columns) and step `status` (chain). The engine's rule (`resolveTaskStatus`): any active agent step with a runtime → IN_PROGRESS; only human/no-runtime steps active → WAITING; all done/skipped → DONE. **REVIEW is never produced by the chain engine** — it exists solely for pull agents self-reporting "done, please check".

Dragging a 4-step chained task between columns means:

- **→ IN_PROGRESS**: starts the chain, but only if no step was ever touched. Otherwise a cosmetic move.
- **→ BACKLOG / DONE / REVIEW / WAITING**: *pure label change.* Steps keep executing — the dispatch query filters active steps only by `task.deletedAt`, **not by task status**. A chained task dragged to DONE keeps running and spending money; the next step completion snaps the column back, undoing the user's drag. The only real "stop" affordances live elsewhere: pause the agent, `closeChain`, or delete the task.
- The column is a *derived read-model* of the steps — but the UI presents it as a writable control.

### 1.5 What modes actually change at runtime

For HTTP dispatch: (1) instruction text injected into the prompt — the agent's per-mode `modeInstructions` **override** (not merge with) the project mode's `instructions`; (2) an `outputFormat` hint; (3) MCP tool filtering (mode heuristics + the mode's `toolAllowlist`); (4) default `maxAttempts`; (5) `mode === 'human'` is a magic value: exempt from dispatch, becomes a review gate. On the daemon path the mode additionally maps to a write policy (`develop`/`draft` → write, else read-only plan mode) — but per the gap analysis, mode instructions never reach the daemon payload at all.

---

## PART 2 — Is it logical?

### 2.1 Concept count before first value

To get one AI-executed task, a new user must correctly wire, in order: Workspace (implicitly), Project, **Runtime** (plus a real env var on the server), **Agent** (bound, active, right modes), **Mode** (implicitly via step), **Task + Step** (or trust the invisible auto-step), and **Automation** (default `manual` — nothing runs until found in Settings). ~7 decisions across 3 dialogs before first output; the full surface is ~20 nouns.

**Confusingly-similar pairs:**

- **Agent vs Runtime** — the most important distinction and the least discoverable. An "agent" is a prompt+permissions file; the runtime is the thing that thinks.
- **Mode vs ModeInstructions** — agent per-mode `modeInstructions` silently *replace* the project mode's `instructions`; editing Settings→Modes has no effect on any agent with an override, with no indication why.
- **Task template vs Chain template vs Recurring task vs Project defaults** — four layered retype-avoidance mechanisms; a 3-deep composition chain to predict what a recurring task creates.
- **Skill vs Memory vs Prompt-library** — three knowledge stores, three scopes (workspace / agent+project / server filesystem), three write paths — and only Memory is actually consumed by dispatch. One idea fractured three ways.
- **`isActive` means two things** — presence signal (any agent API call sets it true) *and* the pause switch gating the dispatcher. Pausing a pull agent is self-defeating: its next poll un-pauses it. One boolean encodes "online" and "allowed to work".
- **"Workspace" means two unrelated things** — the entity (projects/daemons/skills container) and `DAEMON_WORKSPACE_ROOT` (an execution directory).
- **"Mode" is used four ways** — ProjectMode, `automationMode`, `invocationMode`, CLI `--permission-mode`. The word carries no stable meaning.

### 2.2 Naming coherence — inventory of drift

| Layer | Name |
|---|---|
| Repo/dir | `AgentBoard` |
| Product UI, README, help, landing | **Conductor** |
| Env vars | `AGENTBOARD_ADMIN_PASSWORD`, `AGENTBOARD_WS_*` |
| Cookies | `agentboard_admin_session`, `agentboard_admin_nonce` |
| Daemon + env | `conductor-daemon`, `CONDUCTOR_URL`, `CONDUCTOR_DAEMON_TOKEN`, but `DAEMON_*` |
| Key prefixes | `ab_agent.…` vs `cd_daemon.…` vs `cr_…` |
| Bootstrap account | `owner@conductor.local` |

A user debugging an install maps three brand names onto one product; the credential prefixes encode the split.

### 2.3 Intuitive vs surprising flows

**Intuitive:** chain creation auto-starting IN_PROGRESS; the review-gate approve/reject flow with feedback re-injection; dead-letter chip + notification bell; templates prefill-but-editable ("a suggestion rather than a surprise"); soft-delete with a 30-day net; invisible-but-audited lease machinery.

**Surprising / incoherent:**

1. **WAITING vs REVIEW is backwards from what everyone — including the app's own help — expects.** The help says gated tasks park in REVIEW; reality: chain human gates park in **WAITING** (proven by `e2e/chain-human-gate.spec.ts`); REVIEW is populated only by external pull agents. The purple "Review" column — where the user is told to look — stays empty in the flagship chain workflow. The two columns partition by *execution model*, not meaning.
2. **The help documents a different application.** The board chapter claims **four columns** and "WAITING doesn't have its own column" — the board renders five. The state-machine chapter claims server-side transition validation with 409s and a "Force close" menu — no transition validation exists; any drag is accepted. The handoff chapter documents `{{ prev.output }}`; the real token is `{{step.previousOutput}}`. It claims dispatch-time role-based load balancing; reality is creation-time binding to the *first* agent with the role. It says daemons hold a persistent WebSocket; they poll HTTP. A 3,125-line in-app manual teaching a wrong model confidently is a first-order conceptual failure — worse than no docs.
3. **Drag is a lie for chained tasks** — dragging out of IN_PROGRESS neither pauses nor cancels dispatch, and the engine shortly overwrites the move. Action-at-a-distance in both directions.
4. **The invisible auto-step.** Assigning an agent to a "plain" task secretly manufactures a chain step in `defaultStepMode` — a one-step chain the user never created, in a mode from a setting they never saw.
5. **Automation defaults to `manual`** with no "automation is off" banner — the most common first-run failure ("I made a chain and nothing happens") has two invisible causes (runtime binding, automation off) plus a third (agent paused).
6. **Workspaces are a phantom.** A header switcher exists, the schema makes Workspace the top container, the glossary calls it that — but `currentWorkspaceId` scopes exactly one thing (the Skills page). Switching visibly does nothing. Meanwhile it is *invisibly load-bearing*: daemon dispatch fails for projects without a workspace, naming a concept the UI never made real.

### 2.4 Does the multi-path execution design surface coherently?

No — and it is really **three** paths (pull-API, server-dispatch, daemon) flattened into one "Agent" noun. `invocationMode` covers HTTP vs DAEMON; the pull model isn't represented at all — any agent's key drives the Model-B API regardless of mode. The user experiences one concept behaving three ways: completion semantics differ (tasks vs steps), the review destination differs (REVIEW vs WAITING), crash-recovery timing differs (30s–15min, unexplained), and capability differs silently (daemon agents lose memory, chain context, rejection feedback, retries, budgets, MCP — per the gap analysis). The help sells "mix them freely; Conductor picks the right runner automatically" — true for routing, false for behavior.

### 2.5 Defaults & first-run

Works out of the box: SQLite, mode seeding, starter agents, demo seed, help page, auth bootstrap. Weakly surfaced: realtime (two WS secrets + a build-time public URL; at least shows "Realtime Off"), any actual LLM call (the `apiKeyEnvVar` indirection is never explained in the UI; a missing key fails only at dispatch time as a failed step), wizard (two prerequisites), embeddings (silent substring fallback), email (SMTP vars absent from `.env.example`), daemon (a 5-env-var, cookie-registered side quest).

### 2.6 What to CUT or MERGE (ranked)

1. **Merge WAITING and REVIEW** into one "Needs attention" column (or make REVIEW the single human-gate destination). The split leaks the internal execution-model distinction into the primary surface. Highest-leverage conceptual fix.
2. **Merge the three template concepts** — a TaskTemplate that *contains* an optional chain, with recurrence as a property ("run weekly"), collapses ChainTemplate + TaskTemplate + RecurringTask into one "Template" noun.
3. **Split `isActive`** into `paused` (human intent) and `lastSeen`-derived presence — the pause switch is unreliable for pull agents by construction.
4. **Cut or commit to Workspaces** — finish them (filter projects, scope settings) or demote to an invisible daemon-routing detail.
5. **Unify knowledge** — Skills, Memory, and the prompt archive want to be one "Library" with scopes and one injection story. Skills aren't consumable by agents today (gap 1.13), so the merge is cheap.
6. **One brand** — pick Conductor; alias `AGENTBOARD_*` for one release; rename `ab_` prefixes on next rotation.
7. **Make drag honest** — dragging a chained task out of IN_PROGRESS should pause/close the chain (the `closeChain` verb exists) or be refused with an explanation, not silently reverted.
8. **Rewrite the help board/state-machine/handoff chapters against the code** — the manual needs the same truth-in-features pass as the README, and its errors are more fundamental.

**Missing pieces the model implies:** a task-level Pause/Cancel verb; an "automation off" empty-state hint; visible distinction between the cosmetic `Task.agentId` and the step agents who actually work; dispatch-time role resolution (matching the help's promise); a first-class `invocationMode: EXTERNAL` so the three real execution models are the three the user sees.

### Bottom line

The engine's conceptual core — steps paired with modes, lease-based dispatch, human gates, derived task status — is genuinely well-designed and internally consistent (the ADRs are honest and the invariants hold). The incoherence lives at the *membrane* between engine and user: the board pretends to be a control surface but is mostly a read-model; the five columns encode an implementation split rather than user meaning; one "Agent" noun hides three execution models with different physics; four overlapping template/knowledge subsystems each solve a sliver of the same problem; and the product's own manual describes a materially different application. A user can reach competence — but only by unlearning what the app itself teaches them.
