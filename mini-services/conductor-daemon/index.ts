/**
 * Conductor reference daemon — proves the daemon protocol end to end:
 *
 *   register (one-time, admin-assisted) → heartbeat loop → poll steps/next
 *   → create/reuse a session per the server's session block → execute →
 *   stream output as session events → complete/fail the step with sessionId.
 *
 * SAFETY DEFAULT: without an explicit commandTemplate on the runtime config,
 * this daemon NEVER executes step instructions as shell. It runs a no-op
 * echo runner that proves the protocol. Point commandTemplate at a real tool
 * (claude-code, codex, a build script) to do real work.
 *
 * Run: bun index.ts            (needs CONDUCTOR_DAEMON_TOKEN)
 *      bun index.ts --register (one-time; needs an admin session cookie)
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, platform, arch } from 'node:os'
import { join } from 'node:path'

const BASE_URL = (process.env.CONDUCTOR_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.CONDUCTOR_DAEMON_TOKEN || ''
const CAPABILITY = process.env.DAEMON_CAPABILITY || 'claude-code'
const POLL_INTERVAL_MS = Number(process.env.DAEMON_POLL_INTERVAL_MS || 5000)
const HEARTBEAT_INTERVAL_MS = 30_000

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

interface SessionBlock {
  policy: string
  backend: string
  sessionKey: string
  command: string | null
  maxOutputPreviewChars: number
}

async function upsertSession(step: StepPayload): Promise<string | null> {
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
// Step execution
// ---------------------------------------------------------------------------

interface StepPayload {
  id: string
  taskId: string
  mode: string
  instructions: string | null
  timeoutMs: number | null
  session: SessionBlock
  agent: { id: string; name: string } | null
  task: { id: string; title: string }
}

function buildCommand(step: StepPayload): { cmd: string; args: string[] } {
  if (step.session.command) {
    // Explicitly configured command template — run through the shell
    const shell = platform() === 'win32' ? 'cmd' : 'sh'
    const flag = platform() === 'win32' ? '/c' : '-c'
    return { cmd: shell, args: [flag, step.session.command] }
  }
  // SAFETY DEFAULT: no-op echo runner. Never execute instructions as shell.
  const summary = `conductor-daemon echo runner: step ${step.id} (${step.mode}) of task "${step.task.title}"`
  return platform() === 'win32'
    ? { cmd: 'cmd', args: ['/c', 'echo', summary] }
    : { cmd: 'echo', args: [summary] }
}

async function executeStep(step: StepPayload): Promise<void> {
  console.log(`[step] ${step.id} (${step.mode}) — session ${step.session.sessionKey}`)
  runningTasks++

  const sessionId = await upsertSession(step)
  if (sessionId) activeSessions++

  const { cmd, args } = buildCommand(step)
  if (sessionId) {
    await sessionEvent(sessionId, { type: 'command', commandSummary: [cmd, ...args].join(' ').slice(0, 500) })
  }

  const child = spawn(cmd, args, { shell: false })
  let output = ''

  const stream = (streamName: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    if (sessionId) {
      void sessionEvent(sessionId, { type: 'output', stream: streamName, chunk: text.slice(0, 8000) })
    }
  }
  child.stdout?.on('data', stream('stdout'))
  child.stderr?.on('data', stream('stderr'))

  const timeoutMs = step.timeoutMs ?? 300_000
  const exitCode: number = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve(124)
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(127)
    })
  })

  if (sessionId) {
    await sessionEvent(sessionId, {
      type: 'status',
      status: exitCode === 0 ? 'exited' : 'failed',
      exitCode,
    })
    activeSessions = Math.max(0, activeSessions - 1)
  }

  try {
    await api('/api/daemon/steps', {
      method: 'POST',
      body: JSON.stringify(
        exitCode === 0
          ? { stepId: step.id, action: 'complete', output: output.slice(0, 50_000), sessionId: sessionId ?? undefined }
          : {
              stepId: step.id,
              action: 'fail',
              error: `exit code ${exitCode}: ${output.slice(-500)}`,
              willRetry: false,
              sessionId: sessionId ?? undefined,
            },
      ),
    })
    console.log(`[step] ${step.id} ${exitCode === 0 ? 'completed' : `failed (${exitCode})`}`)
  } catch (err) {
    console.error(`[step] ${step.id} completion report failed:`, err)
  } finally {
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
      await executeStep(body.step as StepPayload)
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

  console.log(`conductor-daemon → ${BASE_URL} (capability: ${CAPABILITY})`)
  await heartbeat()
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
  setInterval(poll, POLL_INTERVAL_MS)
  void poll()
}

main()
