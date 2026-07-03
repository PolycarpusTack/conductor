# CONTRACT SNAPSHOT: Daemon Execution Payload

Version: 1 (`payloadVersion: 1`)
Date: 2026-07-03 (A-1)

## Public Interface

`GET /api/daemon/steps/next` (daemon-token auth) →

```ts
{ step: ExecutionPayload | null }

interface ExecutionPayload {
  payloadVersion: 1            // bump on any breaking change to this shape
  id: string                   // step id
  taskId: string
  order: number
  mode: string                 // step mode (develop|draft|analyze|verify|review|human|custom)
  instructions: string | null  // step instructions — stdin prose, NEVER shell/argv
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
    systemPrompt: string | null      // → temp file + --append-system-prompt-file
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

On success: claude runner reports the result line's `result` string as step
output (cost/session metadata logged; evidence capture is A-3); generic and
echo runners report raw stdout.

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

## Error Shapes (HTTP)

- 401 `{ error }` — missing/invalid daemon token
- 200 `{ step: null }` — nothing leased to this daemon

## Dependencies

- Server: step leased via `pollAndDispatch` (step-queue) with
  `invocationMode = 'DAEMON'`; session policy from `ProjectRuntime.config`
- Daemon: opt-in runner config (`DAEMON_RUNNER=claude`, `DAEMON_CLAUDE_BIN`,
  `DAEMON_CLAUDE_MAX_TURNS`, `DAEMON_SYSTEM_PROMPT_MODE`); default is the
  no-op echo runner

## Domain Terms Used

Runner, Execution Payload, Daemon, Chain (see architecture-memory.md §Glossary)
