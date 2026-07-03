# EPIC A Runbook — Daemon Execution (operator guide)

How it works, in one breath: `pollAndDispatch` leases a DAEMON-mode step to an
online daemon in the project's workspace; the daemon polls
`GET /api/daemon/steps/next`, spawns the CLI (spawn array, never a shell) with
the composed prompt on stdin, cwd = its `DAEMON_WORKSPACE_ROOT`, streams
stdout/stderr as session events, and reports completion with git evidence.

## Symptoms → checks

**Step sits `active`, nothing ever starts.**
1. Is a daemon online in the *project's workspace*? `bun run doctor` (daemon
   census), Runtime Dashboard → Hosts, or `GET /api/hosts`. Dispatch is
   strictly workspace-scoped — a daemon in another workspace will never match.
2. Does the agent have `invocationMode=DAEMON` **and** a runtime whose adapter
   maps to the daemon's capability? Mapping: `anthropic`→`claude-code`,
   `openai`→`codex`, `github-copilot`→`copilot` (daemon-dispatch.ts). No
   runtime on the agent = the queue never selects the step.
3. Project has no workspace → activity shows `daemon_dispatch_failed` /
   `missing_workspace`. Assign a workspace in settings.
4. Is automation polling? Project automation mode `manual` never polls — start
   it, or poke `POST /api/internal/poll-steps` (header `x-internal-secret`).

**Step leased but never completes ("stuck leased").**
The daemon died mid-step. Self-heals two ways: a daemon that misses
heartbeats ~30s flips `online→stale` on the next sweep and its leases are
released *immediately* (B-3) — look for `lease_reclaimed` activity with
`reason: daemon_stale`; independently, any lease older than 10 min
(`LEASE_TIMEOUT_MS`) is stealable at next dispatch. If neither fired within
~2 min, check whether something is still heartbeating with that daemon token.

**Steps fail with `workspace_unmapped`.**
The daemon has no valid `DAEMON_WORKSPACE_ROOT` (must be absolute, existing,
a directory — validated at startup), or a `task-dir` resolution escaped the
root. There is deliberately no fallback to the daemon's own cwd (headless
CLIs skip the trust dialog). Fix the env var, restart the daemon.

**Claude-runner failures with exit 0 (`is_error`).**
The CLI's final stream-json result line is authoritative: `is_error: true` or
a missing result line fails the step even on exit 0. Read the step's error
text (stderr tail) and the session `outputPreview`; usual culprits are CLI
auth/model problems in the daemon's environment.

**`command template rejected: unknown tokens`.**
The runtime config's `commandTemplate` may only reference
`agent.runtimeModel`, `task.id`, `step.id`, `step.mode`. Anything else fails
loudly before anything spawns — fix the template in the runtime config.

## Where the evidence lives

- **Session events** — `AgentSession` rows: `GET /api/sessions?taskId=…` or
  Runtime Dashboard → Sessions. Live chunks stream over project WS; persisted
  is a bounded, secret-redacted `outputPreview` + command + status/exitCode.
- **Step events** (`started`/`succeeded`/`failed`/`retry_scheduled`/
  `lease_reclaimed` audit): `GET /api/tasks/{taskId}/steps/{stepId}/evidence`
  returns the full packet (events, artifacts, sessions, messages).
- **Artifacts** — step drawer or `…/steps/{stepId}/artifacts`: `git diff
  --stat` (diff artifact; NB: brand-new untracked files show in
  `metadata.dirtyFiles`, not in the diff text) and `claude run metadata`
  (cost/turns/session id) on claude runs. Attached on success AND failure.
- **Step output** — `TaskStep.output`, daemon-reported tail (64k cap) clamped
  to 5000 chars server-side; the session preview holds the streamed view.

## Requeue

Exhausted **HTTP-dispatched** steps land in the dead-letter panel (project
settings) — Requeue (`POST /api/projects/{id}/dead-letters`) resets the step
to `active` with attempts 0. **Daemon-path terminal failures do NOT
dead-letter today** (the daemon reports `willRetry: false`; the step just
goes `failed`) — recover via chain rewind on the task or by re-running the
step from the drawer. Known gap, candidate for EPIC B.

## Running the daemon e2e smoke (spend-free)

```bash
bun run smoke:daemon            # add --json, --no-reclaim; SMOKE_PORT=3112 to move ports
```

Boots the app on `SMOKE_PORT` (default 3111), logs in with the `.env` admin
credentials (`SMOKE_ADMIN_EMAIL` overrides the owner email), builds a
throwaway workspace/project/DAEMON agent, registers a daemon whose generic
runner is `scripts/daemon-e2e-fixture.ts` (no LLM call ever), and asserts:
step done, task DONE, `smoke-output.md` written in the temp git workspace
with the prompt marker, fixture stdout as step output, git-evidence artifact,
session events recorded, and (unless `--no-reclaim`) that killing the daemon
mid-step gets the lease reclaimed by the stale sweep. Cleans up after itself
(project delete cascades, daemon row removed, temp dir deleted).

**KNOWN ISSUE (open):** `POST /api/daemon/register` rejects partial
capability sets — `registerDaemonSchema` uses zod-v4 `z.record(z.enum(…))`,
which demands *all* enum keys (`src/lib/server/daemon-contracts.ts`,
`capabilities` field). The reference daemon's `--register` (one capability)
400s with `Invalid input: expected object, received undefined`, and the smoke
fails at `e2e-daemon-register`, until the schema moves to `z.partialRecord`.
