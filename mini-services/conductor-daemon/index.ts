/**
 * Conductor reference daemon — proves the daemon protocol end to end:
 *
 *   register (one-time, admin-assisted) → heartbeat loop → poll steps/next
 *   → create/reuse a session per the server's session block → execute →
 *   stream output as session events → complete/fail the step with sessionId.
 *
 * SAFETY DEFAULT: real execution is opt-in. Without `DAEMON_RUNNER=claude`
 * or a server-configured commandTemplate, this daemon NEVER executes step
 * instructions — it runs a shell-less no-op echo runner that proves the
 * protocol. Runner mechanics (spawn spec, stdin prompt delivery, stream-json
 * parsing) live in runner.ts, built per SPIKE A-0's invocation contract.
 *
 * Run: bun index.ts            (needs CONDUCTOR_DAEMON_TOKEN)
 *      bun index.ts --register (one-time; needs an admin session cookie)
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, platform, arch } from 'node:os'
import { join } from 'node:path'

import {
  buildSpawnSpec,
  interpretResult,
  resolveRunnerKind,
  runSpawnSpec,
  validateExecutionPayload,
  type ClaudeRunnerOptions,
  type ExecutionPayload,
  type RunnerKind,
} from './runner'
import { resolveStepCwd, resolveWorkspaceRoot } from './workspace'

const BASE_URL = (process.env.CONDUCTOR_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.CONDUCTOR_DAEMON_TOKEN || ''
const CAPABILITY = process.env.DAEMON_CAPABILITY || 'claude-code'
const POLL_INTERVAL_MS = Number(process.env.DAEMON_POLL_INTERVAL_MS || 5000)
const HEARTBEAT_INTERVAL_MS = 30_000

// Runner configuration — real execution is opt-in (see resolveRunnerKind).
const RUNNER_ENV = process.env.DAEMON_RUNNER
const CLAUDE_OPTS: ClaudeRunnerOptions = {
  binArgv: [process.env.DAEMON_CLAUDE_BIN || 'claude'],
  maxTurns: Number(process.env.DAEMON_CLAUDE_MAX_TURNS || 30),
  systemPromptMode: process.env.DAEMON_SYSTEM_PROMPT_MODE === 'arg' ? 'arg' : 'file',
}

// Workspace mapping (A-2, SECURITY): the one directory steps may execute in.
// Validated in main() — invalid config aborts startup; unset means every
// step fails `workspace_unmapped` (never the daemon's own cwd).
let workspaceRoot: string | null = null

// ---------------------------------------------------------------------------
// Installation identity — survives hostname changes (roadmap decision D1)
// ---------------------------------------------------------------------------

function installationId(): string {
  const dir = join(homedir(), '.conductor-daemon')
  const file = join(dir, 'installation-id')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const id = `inst-${randomUUID()}`
  writeFileSync(file, id)
  return id
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {}),
    },
  })
}

// ---------------------------------------------------------------------------
// One-time registration (admin-assisted: registration is admin-session-gated)
// ---------------------------------------------------------------------------

async function register(): Promise<void> {
  const cookie = process.env.CONDUCTOR_ADMIN_COOKIE
  if (!cookie) {
    console.error(
      'Registration needs an admin session cookie.\n' +
        'Log into the dashboard, copy the agentboard_admin_session + agentboard_admin_nonce\n' +
        'cookies, and set CONDUCTOR_ADMIN_COOKIE="agentboard_admin_session=...; agentboard_admin_nonce=..."',
    )
    process.exit(1)
  }

  const res = await fetch(`${BASE_URL}/api/daemon/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      hostname: hostname(),
      platform: platform(),
      version: '0.1.0',
      capabilities: { [CAPABILITY]: { version: '0.1.0' } },
      host: {
        installationId: installationId(),
        hostname: hostname(),
        arch: arch(),
        trustLevel: 'local',
      },
      sessionCapabilities: { backends: ['process'], supportsStreaming: true },
    }),
  })

  const body = await res.json()
  if (!res.ok) {
    console.error('Registration failed:', body)
    process.exit(1)
  }

  console.log('Registered. Save this token (shown once):\n')
  console.log(`  CONDUCTOR_DAEMON_TOKEN=${body.token}\n`)
  console.log(`daemonId: ${body.daemonId}  hostId: ${body.hostId ?? 'n/a'}`)
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let runningTasks = 0
let activeSessions = 0

async function heartbeat(): Promise<void> {
  try {
    await api('/api/daemon/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runningTasks, activeSessions }),
    })
  } catch (err) {
    console.error('[heartbeat] failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Session reporting
// ---------------------------------------------------------------------------

async function upsertSession(step: ExecutionPayload): Promise<string | null> {
  try {
    const res = await api('/api/daemon/sessions', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: step.session.sessionKey,
        backend: step.session.backend,
        command: step.session.command ?? undefined,
        agentId: step.agent?.id,
        taskId: step.taskId,
        stepId: step.id,
        status: 'active',
      }),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body.sessionId
  } catch {
    return null
  }
}

async function sessionEvent(sessionId: string, event: Record<string, unknown>): Promise<void> {
  try {
    await api(`/api/daemon/sessions/${sessionId}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  } catch {
    // session reporting must never break execution
  }
}

// ---------------------------------------------------------------------------
// Step execution — spawn spec + failure semantics live in runner.ts
// ---------------------------------------------------------------------------

async function reportStep(
  step: ExecutionPayload,
  result: { ok: boolean; output: string; error: string | null },
  sessionId: string | null,
): Promise<void> {
  try {
    await api('/api/daemon/steps', {
      method: 'POST',
      body: JSON.stringify(
        result.ok
          ? {
              stepId: step.id,
              action: 'complete',
              output: result.output.slice(0, 50_000),
              sessionId: sessionId ?? undefined,
            }
          : {
              stepId: step.id,
              action: 'fail',
              error: result.error ?? 'unknown runner failure',
              willRetry: false,
              sessionId: sessionId ?? undefined,
            },
      ),
    })
    console.log(`[step] ${step.id} ${result.ok ? 'completed' : `failed (${result.error})`}`)
  } catch (err) {
    console.error(`[step] ${step.id} completion report failed:`, err)
  }
}

async function executeStep(step: ExecutionPayload): Promise<void> {
  console.log(`[step] ${step.id} (${step.mode}) — session ${step.session.sessionKey}`)
  runningTasks++

  const sessionId = await upsertSession(step)
  if (sessionId) activeSessions++

  try {
    // Contract guard — a payload the runner cannot interpret fails loudly
    // instead of half-executing.
    const payloadProblems = validateExecutionPayload(step)
    if (payloadProblems.length > 0) {
      await reportStep(step, { ok: false, output: '', error: `invalid execution payload: ${payloadProblems.join('; ')}` }, sessionId)
      return
    }

    // Server-side template rejection (unknown tokens) — never execute.
    if (step.session.commandError) {
      await reportStep(step, { ok: false, output: '', error: `command template rejected: ${step.session.commandError}` }, sessionId)
      return
    }

    // SECURITY (A-2): headless CLIs skip the workspace trust dialog, so the
    // child may only ever run inside the configured workspace directory. An
    // unresolvable workspace fails the step BEFORE anything spawns.
    const cwdResolution = resolveStepCwd(workspaceRoot, {
      taskId: step.taskId,
      workingDirectoryPolicy: step.session.workingDirectoryPolicy,
    })
    if (!cwdResolution.ok) {
      await reportStep(step, { ok: false, output: '', error: cwdResolution.error }, sessionId)
      return
    }
    if (step.session.workingDirectoryPolicy === 'task-dir') {
      mkdirSync(cwdResolution.cwd, { recursive: true })
    }

    const kind: RunnerKind = resolveRunnerKind(RUNNER_ENV, Boolean(step.session.command))
    let spec
    try {
      spec = buildSpawnSpec(kind, step, CLAUDE_OPTS)
    } catch (err) {
      // e.g. TemplateTokenError — loud failure, no spawn.
      await reportStep(step, { ok: false, output: '', error: `runner spec rejected: ${String(err instanceof Error ? err.message : err)}` }, sessionId)
      return
    }

    if (sessionId) {
      await sessionEvent(sessionId, { type: 'command', commandSummary: spec.summary })
    }

    const streamTo = (streamName: 'stdout' | 'stderr') => (chunk: string) => {
      if (sessionId) {
        void sessionEvent(sessionId, { type: 'output', stream: streamName, chunk: chunk.slice(0, 8000) })
      }
    }

    const proc = await runSpawnSpec(spec, {
      timeoutMs: step.timeoutMs ?? 300_000,
      cwd: cwdResolution.cwd,
      onStdout: streamTo('stdout'),
      onStderr: streamTo('stderr'),
    })
    const outcome = interpretResult(spec.kind, proc)

    if (outcome.claude) {
      console.log(
        `[step] ${step.id} claude result: cost=$${outcome.claude.totalCostUsd ?? '?'} ` +
          `turns=${outcome.claude.numTurns ?? '?'} session=${outcome.claude.sessionId ?? '?'}`,
      )
    }

    if (sessionId) {
      await sessionEvent(sessionId, {
        type: 'status',
        status: outcome.ok ? 'exited' : 'failed',
        exitCode: outcome.exitCode,
      })
    }

    await reportStep(step, outcome, sessionId)
  } finally {
    if (sessionId) activeSessions = Math.max(0, activeSessions - 1)
    runningTasks = Math.max(0, runningTasks - 1)
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

let busy = false

async function poll(): Promise<void> {
  if (busy) return
  try {
    const res = await api('/api/daemon/steps/next')
    if (!res.ok) return
    const body = await res.json()
    if (!body.step) return

    busy = true
    try {
      await executeStep(body.step as ExecutionPayload)
    } finally {
      busy = false
    }
  } catch (err) {
    console.error('[poll] failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.includes('--register')) {
    await register()
    return
  }

  if (!TOKEN) {
    console.error('CONDUCTOR_DAEMON_TOKEN is required (run with --register first).')
    process.exit(1)
  }

  // Fail loudly at startup on a misconfigured runner or workspace — not
  // mid-step. A relative, missing, or non-directory DAEMON_WORKSPACE_ROOT
  // aborts here (workspace.ts validation).
  try {
    resolveRunnerKind(RUNNER_ENV, false)
    workspaceRoot = resolveWorkspaceRoot(process.env.DAEMON_WORKSPACE_ROOT)
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
  if (!workspaceRoot) {
    console.warn(
      '[startup] DAEMON_WORKSPACE_ROOT is not set — every step will fail with ' +
        'workspace_unmapped. The runner never executes in the daemon\'s own cwd ' +
        '(headless CLIs skip the workspace trust dialog — SPIKE A-0).',
    )
  }
  const runnerLabel =
    (RUNNER_ENV ?? '').trim() === 'claude'
      ? `claude (${CLAUDE_OPTS.binArgv?.join(' ')})`
      : 'echo/template (server commandTemplate decides; set DAEMON_RUNNER=claude for the claude runner)'

  console.log(
    `conductor-daemon → ${BASE_URL} (capability: ${CAPABILITY}, runner: ${runnerLabel}, ` +
      `workspace: ${workspaceRoot ?? 'UNMAPPED'})`,
  )
  await heartbeat()
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
  setInterval(poll, POLL_INTERVAL_MS)
  void poll()
}

main()
