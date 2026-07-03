# conductor-daemon — reference implementation

A single-file bun daemon that proves the Conductor daemon protocol end to end:
register → heartbeat → poll → session reporting → step completion.

## Safety default & runners

**Real execution is opt-in.** Without `DAEMON_RUNNER=claude` or an explicit
`commandTemplate` on the runtime config, this daemon never executes step
instructions — it runs a shell-less no-op echo runner that exercises the full
protocol (sessions, output streaming, completion).

Three runners (`runner.ts`, per the SPIKE A-0 invocation contract — nothing is
ever spawned through a shell; instructions always ride stdin):

1. **claude** (`DAEMON_RUNNER=claude`): spawns
   `claude -p --output-format stream-json --verbose --no-session-persistence
   [--append-system-prompt-file <tmp>] [--model <agent.runtimeModel>]
   --max-turns N --permission-mode <mapped from step.mode>`.
   Instructions are piped to stdin; the system prompt travels via a temp file
   that is deleted after the run. The final stream-json `result` line is
   authoritative: `is_error: true` fails the step even on exit 0.
2. **template** (server-side opt-in): the runtime config's `commandTemplate`,
   resolved server-side, is split into an argv array and spawned with
   `shell: false`; the composed prompt is piped to stdin. Templates referencing
   unknown tokens are rejected loudly (step fails; nothing runs).
3. **echo** (default): no-op protocol proof.

To use the template runner, set a session policy on the agent's runtime
config, e.g.:

```json
{
  "sessionPolicy": "persistent-agent",
  "sessionBackend": "process",
  "commandTemplate": "codex exec --model {{agent.runtimeModel}}"
}
```

Template tokens (whitelist — anything else fails the step):
`{{agent.runtimeModel}}`, `{{task.id}}`, `{{step.id}}`, `{{step.mode}}`.

## Setup

1. **Register** (one-time; registration is admin-session-gated by design):

   ```bash
   # Log into the dashboard, copy the admin session cookies, then:
   CONDUCTOR_URL=http://localhost:3000 \
   CONDUCTOR_ADMIN_COOKIE="agentboard_admin_session=...; agentboard_admin_nonce=..." \
   bun index.ts --register
   ```

   Prints `CONDUCTOR_DAEMON_TOKEN=...` **once** — save it. Registration sends a
   `host` block with a persisted installation ID (`~/.conductor-daemon/installation-id`),
   so the machine keeps one durable Host identity across re-registrations.

2. **Run:**

   ```bash
   CONDUCTOR_URL=http://localhost:3000 \
   CONDUCTOR_DAEMON_TOKEN=cd_daemon.... \
   bun index.ts
   ```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `CONDUCTOR_URL` | `http://localhost:3000` | Conductor server |
| `CONDUCTOR_DAEMON_TOKEN` | — | Daemon token from `--register` |
| `DAEMON_CAPABILITY` | `claude-code` | Capability advertised at registration (matches runtime adapter mapping) |
| `DAEMON_POLL_INTERVAL_MS` | `5000` | Step poll cadence |
| `CONDUCTOR_ADMIN_COOKIE` | — | Only for `--register` |
| `DAEMON_RUNNER` | — | `claude` opts into the claude runner; `echo` forces the no-op; unset → template if configured, else echo. Unknown values abort startup. |
| `DAEMON_CLAUDE_BIN` | `claude` | Claude CLI binary (claude runner) |
| `DAEMON_CLAUDE_MAX_TURNS` | `30` | `--max-turns` ceiling per invocation |
| `DAEMON_SYSTEM_PROMPT_MODE` | `file` | `arg` inlines system prompts < 8KB via `--append-system-prompt` instead of the temp file |

## Behavior

- Heartbeats every 30s with `runningTasks` / `activeSessions` metrics (feeds host presence).
- Polls `GET /api/daemon/steps/next`; the response's `session` block tells it
  which session key/backend to use — reuse semantics are server-decided.
- Reports the session via `POST /api/daemon/sessions`, streams stdout/stderr as
  bounded output events (server-side redaction applies), and marks the session
  `exited`/`failed` with the exit code.
- Completes/fails the step with `sessionId` attached — that's the durable
  step↔session evidence link.
- `backends`: this reference implements `process` only. `pty`/`tmux` need
  native dependencies and are left to real daemon implementations.
- Executes one step at a time (`busy` gate); concurrency is a real-daemon concern.

## Status & operations

Daemon and host presence is visible via `bun run doctor` (daemon census
check), the Runtime Dashboard's Hosts/Sessions tabs, and `GET /api/hosts`.
To run as an OS service, wrap `bun index.ts` in systemd/launchd/a Windows
service — there is intentionally no installer script in v1.
