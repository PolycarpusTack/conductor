# conductor-daemon — reference implementation

A single-file bun daemon that proves the Conductor daemon protocol end to end:
register → heartbeat → poll → session reporting → step completion.

## Safety default

**Without an explicit `commandTemplate` on the runtime config, this daemon
never executes step instructions as shell.** It runs a no-op echo runner that
exercises the full protocol (sessions, output streaming, completion). To do
real work, set a session policy on the agent's runtime config, e.g.:

```json
{
  "sessionPolicy": "persistent-agent",
  "sessionBackend": "process",
  "commandTemplate": "claude-code --model {{agent.runtimeModel}}"
}
```

Template tokens: `{{agent.runtimeModel}}`, `{{task.id}}`, `{{step.id}}`, `{{step.mode}}`.

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
