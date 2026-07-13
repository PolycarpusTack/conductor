# CONTRACT SNAPSHOT: Daemon Execution Payload

Version: 2 (`payloadVersion: 2`)
Date: 2026-07-13 (G1-4)
History: v1 2026-07-03 (A-1; cwd/policy A-2; streaming + evidence artifacts A-3).
**v2 (G1-1-T3):** `instructions` and `agent.systemPrompt` now arrive **server-
resolved** — `resolvePrompt` runs on the server (via `dispatch.buildResolvedPrompt`,
the same resolver the HTTP path uses), so the daemon never receives a literal
`{{task.title}}`/`{{memory.recent}}` token (gap 1.1). New field **`previousOutput:
string | null`** carries the prior step's output for chain context (gap 1.2).
**G1-4 (optional field, no version bump):** top-level **`modeInstructions:
string | null`** — the SERVER-LAYERED mode-instruction string for this step's
mode (agent-mode override `||` projectMode.instructions, plus the projectMode
output-format hint), i.e. exactly the layer `buildResolvedPrompt` computes for
the HTTP path. When the field is present it is authoritative — the daemon's
`composeSystemPrompt` uses it and skips its legacy client-side parse of
`agent.modeInstructions` (which never carried the projectMode layer); the field
absent means an older server, and the legacy parse still applies.

## Public Interface

`GET /api/daemon/steps/next` (daemon-token auth) →

```ts
{ step: ExecutionPayload | null }

interface ExecutionPayload {
  payloadVersion: 2            // bump on any breaking change to this shape
  id: string                   // step id
  taskId: string
  order: number
  mode: string                 // step mode (develop|draft|analyze|verify|review|human|custom)
  instructions: string | null  // step instructions, SERVER-RESOLVED (v2) — stdin prose, NEVER shell/argv
  previousOutput: string | null// prior step's output (v2) — chain context, stdin prose
  rejectionNote: string | null // reviewer feedback on a rewound re-run (v2, G1-2) — raw human text
  modeInstructions: string | null // SERVER-LAYERED mode instructions (G1-4) — see header note
  timeoutMs: number | null     // daemon kills the child after this (default 300000)
  retryDelayMs: number | null
  maxRetries: number | null
  attempt: number              // 1-based
  traceContext: string | null  // W3C trace carrier
  runtime: string | null
  session: {
    policy: 'ephemeral' | 'persistent-agent' | 'persistent-task' | 'persistent-step'
    backend: 'pty' | 'tmux' | 'process' | 'container'
    sessionKey: string         // server-computed reuse key
    command: string | null     // resolved commandTemplate (generic runner argv source), or null
    commandError: string | null// set iff template referenced unknown tokens — daemon must
                               // FAIL the step with this message, never execute
    workingDirectoryPolicy: 'project-root' | 'task-dir' | 'daemon-default'
    idleRequiredBeforeCommand: boolean
    maxOutputPreviewChars: number
  }
  agent: {
    id: string
    name: string
    systemPrompt: string | null      // SERVER-RESOLVED (v2) → temp file + --append-system-prompt-file
    modeInstructions: string | null  // JSON string Record<mode, string>; [step.mode] joins systemPrompt
    mcpConnectionIds: string | null
    runtimeModel: string | null      // → --model flag when set
  } | null
  task: { id: string; title: string; description: string | null; projectId: string }
}
```

Template tokens allowed in `commandTemplate` (server-owned scalars only):
`agent.runtimeModel`, `task.id`, `step.id`, `step.mode`. Anything else →
`command: null` + `commandError` (loud, no silent drop).

Daemon-side guard: `validateExecutionPayload(value): string[]`
(`mini-services/conductor-daemon/runner.ts`) — empty array means runnable;
the daemon fails the step listing the problems otherwise. The route test
asserts server responses pass this guard (contract tested both directions).

## Runner Failure Semantics

The daemon reports back via `POST /api/daemon/steps`
(`action: 'complete' | 'fail'`). A step FAILS when any of:

- child exit code ≠ 0 → `fail`, error = `exit code N: <stderr tail (500 chars)>`
- daemon-side timeout → child killed, exit 124, error notes `(daemon timeout)`
- spawn error (binary missing) → exit 127
- claude runner only: exit 0 but final stream-json `"type":"result"` line has
  `is_error: true`, or no result line at all (exit code is not authoritative —
  spike A-0 finding #8)
- `session.commandError` set, invalid payload, or residual `{{token}}` in
  `session.command` → fail loudly before spawning anything
- `workspace_unmapped` (A-2): the daemon has no `DAEMON_WORKSPACE_ROOT`
  configured, or a `task-dir` working-directory resolution escapes the
  configured root → fail loudly BEFORE spawning. The runner never falls back
  to the daemon's own cwd (SECURITY — headless CLIs skip the workspace trust
  dialog, spike A-0 §2.6)

On success: claude runner reports the result line's `result` string as step
output; generic and echo runners report raw stdout. The daemon tail-caps the
reported output at 64_000 chars (tail, not head — for generic runners the end
of stdout is the answer); the server clamps persisted step output to its own
`MAX_OUTPUT_CHARS` (5000).

## Output Streaming & Evidence (A-3)

Live streaming — while the child runs, stdout/stderr flow to
`POST /api/daemon/sessions/[sessionId]/events` as `{ type: 'output', stream,
chunk, truncated? }` events (existing `sessionEventSchema`, unchanged),
batched by `mini-services/conductor-daemon/streaming.ts` (`OutputBatcher`):

- flush every 1.5s or when a stream buffer exceeds 4000 chars
- only COMPLETE lines ship mid-run (NDJSON lines never split); the trailing
  partial line ships on the final flush
- one ordered send queue — events reach the server in flush order
- per-event chunk cap 8000 (schema max); per-stream total cap 256_000 chars,
  beyond which output is dropped with a single `truncated: true` marker (the
  completion report still carries the authoritative output)
- send failures are swallowed — session reporting never breaks execution

Completion evidence — `POST /api/daemon/steps` (both `complete` AND `fail`)
accepts an optional `artifacts` field: max 10 entries, each validated with the
shared `stepArtifactSchema` (`src/lib/server/contracts.ts`: type enum, label ≤
240, content ≤ 50_000, metadata object). Invalid artifacts → 400, nothing
persisted. The daemon attaches (`mini-services/conductor-daemon/evidence.ts`):

- `{ type: 'diff', label: 'git diff --stat' }` — when the resolved cwd is
  inside a git work tree (`git rev-parse --is-inside-work-tree`, spawn array,
  shell: false): `git diff --stat` output (tail-capped 16_000 chars) plus
  `metadata.dirtyFiles` (non-empty `git status --porcelain` lines). Emitted on
  success AND failure; not a repo / git missing → skipped silently.
- `{ type: 'json', label: 'claude run metadata' }` — total_cost_usd,
  num_turns, session_id from the final stream-json result line. **G1-1-T4:** the
  completion route now lifts `totalCostUsd` from this artifact into
  `StepExecution.cost` (the StepExecution row is created at poll time and
  finalized on completion), so daemon spend binds budgets (TD-018b). The artifact
  is retained for evidence; num_turns/session_id still live only here.

## Delivery Mechanics (spike A-0 contract)

- spawn with argument array, `shell: false` — instructions are never
  shell-interpolated (EPIC A DoD 3)
- instructions (task title/description + step instructions) → stdin, single
  write, stdin closed
- systemPrompt (+ modeInstructions[mode]) → runner-owned temp file +
  `--append-system-prompt-file`; deleted after the run
  (`DAEMON_SYSTEM_PROMPT_MODE=arg` inlines prompts < 8KB)
- generic runner: whole composed prompt (system prompt + instructions) rides
  stdin; `session.command` is whitespace-split into argv
- cwd (A-2): every child spawns with `cwd` = the daemon's configured
  workspace path (`DAEMON_WORKSPACE_ROOT`, validated at startup: absolute,
  exists, directory). `session.workingDirectoryPolicy` maps daemon-side:
  `project-root`/`daemon-default`/unknown → workspace root; `task-dir` →
  `<root>/<taskId>` (created on demand, traversal-guarded to the root)
- step policy (A-2): step `mode` derives `readOnly | write` (only
  `develop`/`draft` are write). Claude runner: readOnly →
  `--permission-mode plan`, never a write-capable mode. Generic runner:
  policy exported to the child as `CONDUCTOR_STEP_POLICY=readOnly|write`

## Error Shapes (HTTP)

- 401 `{ error }` — missing/invalid daemon token
- 200 `{ step: null }` — nothing leased to this daemon

## Dependencies

- Server: step leased via `pollAndDispatch` (step-queue) with
  `invocationMode = 'DAEMON'`; session policy from `ProjectRuntime.config`
- Daemon: opt-in runner config (`DAEMON_RUNNER=claude`, `DAEMON_CLAUDE_BIN`,
  `DAEMON_CLAUDE_MAX_TURNS`, `DAEMON_SYSTEM_PROMPT_MODE`); default is the
  no-op echo runner
- Daemon: `DAEMON_WORKSPACE_ROOT` — workspaceId → path registry (a daemon is
  registered into exactly one workspace and the server only leases
  workspace-matched steps, so a single root suffices; no workspaceId field in
  the payload was needed). Unset → every step fails `workspace_unmapped`

## Domain Terms Used

Runner, Execution Payload, Daemon, Chain (see architecture-memory.md §Glossary)
