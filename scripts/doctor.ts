/**
 * Conductor doctor — verifies a deployment end to end.
 *
 *   bun run doctor                  local checks + lenient network checks
 *   bun run doctor --offline        local checks only (CI mode)
 *   bun run smoke-test              network checks must PASS (post-deploy gate)
 *   bun run smoke:daemon            daemon e2e smoke (story A-4, spend-free)
 *   ... --json                      machine-readable output
 *
 * Exit code 1 iff any check FAILS. Network checks are warn-level by default
 * (the board runs fine on polling without the realtime service) and promoted
 * to fail under --smoke.
 *
 * --daemon-e2e boots the app on its own port (SMOKE_PORT, default 3111),
 * registers a throwaway daemon whose generic runner is a local bun fixture
 * (scripts/daemon-e2e-fixture.ts — no LLM spend), drives one DAEMON-mode
 * step through dispatch → lease → spawn → completion, and asserts the file,
 * output, git evidence, and session trail. Everything it creates is cleaned
 * up in finally (project delete cascades; daemon row removed; temp dir gone).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { db } from '../src/lib/db'
import { validateEnv } from '../src/lib/env'
import { LEASE_TIMEOUT_MS } from '../src/lib/server/step-queue'

type Severity = 'pass' | 'warn' | 'fail'

interface CheckResult {
  name: string
  severity: Severity
  detail: string
}

const args = new Set(process.argv.slice(2))
const OFFLINE = args.has('--offline')
const SMOKE = args.has('--smoke')
const JSON_OUT = args.has('--json')
const DAEMON_E2E = args.has('--daemon-e2e')
const SKIP_RECLAIM = args.has('--no-reclaim')

const networkSeverity: Severity = SMOKE ? 'fail' : 'warn'
const results: CheckResult[] = []

function record(name: string, severity: Severity, detail: string) {
  results.push({ name, severity, detail })
}

// ---------------------------------------------------------------------------
// Local checks
// ---------------------------------------------------------------------------

function checkRuntime() {
  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : null
  if (bunVersion) record('runtime', 'pass', `bun ${bunVersion}`)
  else record('runtime', 'warn', `node ${process.version} (bun recommended)`)
}

function checkEnvFile() {
  if (existsSync(join(process.cwd(), '.env'))) record('env-file', 'pass', '.env present')
  else record('env-file', 'warn', 'no .env file — copy .env.example')
}

function checkEnvValidation() {
  try {
    const env = validateEnv()
    record('env-validation', 'pass', `valid (NODE_ENV=${env.NODE_ENV})`)

    if (env.AGENTBOARD_ADMIN_PASSWORD) {
      record('admin-password', 'pass', 'configured')
    } else {
      record('admin-password', 'warn', 'not set — the dashboard cannot be logged into')
    }

    if (env.AGENTBOARD_WS_SECRET && env.AGENTBOARD_WS_INTERNAL_SECRET) {
      record('realtime-secrets', 'pass', 'configured')
    } else {
      record('realtime-secrets', 'warn', 'not set — realtime disabled, board falls back to polling')
    }
  } catch (err) {
    record('env-validation', 'fail', err instanceof Error ? err.message.split('\n').join('; ') : String(err))
  }
}

function checkPrismaClient() {
  if (existsSync(join(process.cwd(), 'src', 'generated', 'prisma'))) {
    record('prisma-client', 'pass', 'generated')
  } else {
    record('prisma-client', 'fail', 'missing — run `bun run db:generate`')
  }
}

async function checkDatabase() {
  try {
    const projects = await db.project.count()
    record('database', 'pass', `reachable (${projects} project${projects !== 1 ? 's' : ''})`)
  } catch (err) {
    record('database', 'fail', `unreachable — ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
  }
}

async function checkRuntimes() {
  try {
    const count = await db.projectRuntime.count()
    if (count > 0) record('llm-runtimes', 'pass', `${count} configured`)
    else record('llm-runtimes', 'warn', 'none configured — agents cannot dispatch')
  } catch {
    record('llm-runtimes', 'warn', 'could not query (database unreachable)')
  }
}

async function checkDaemons() {
  try {
    const [total, online] = await Promise.all([
      db.daemon.count(),
      db.daemon.count({ where: { status: 'online' } }),
    ])
    record('daemons', 'pass', total === 0 ? 'none registered (optional)' : `${online}/${total} online`)
  } catch {
    record('daemons', 'warn', 'could not query (database unreachable)')
  }
}

// SLO-3 signal (docs/ops/slos.md): the claim reaper (60s tick) and lease-steal
// sweep should keep stranded work near zero. This surfaces the current backlog
// of *overdue* reclaims — claims/leases already past expiry that the sweeps
// have not yet returned. A steady non-zero count means a sweep is not running
// (scheduler stopped, or no poller on this DB) — investigate per the
// dispatch-stalled runbook.
async function checkStranded() {
  // 90s grace over the 60s reaper tick — anything older is genuinely overdue,
  // not just mid-cycle.
  const CLAIM_GRACE_MS = 90_000
  try {
    const now = Date.now()
    const [strandedClaims, strandedLeases] = await Promise.all([
      // Model-B claims past expiry with no active step (matches reaper scope).
      db.task.count({
        where: {
          status: 'IN_PROGRESS',
          deletedAt: null,
          claimExpiresAt: { lt: new Date(now - CLAIM_GRACE_MS) },
          steps: { none: { status: 'active' } },
        },
      }),
      // Step leases held past LEASE_TIMEOUT_MS (stealable but not yet stolen —
      // i.e. no dispatch tick has run to steal them).
      db.taskStep.count({
        where: {
          status: 'active',
          leasedBy: { not: null },
          leasedAt: { lt: new Date(now - LEASE_TIMEOUT_MS) },
        },
      }),
    ])
    const total = strandedClaims + strandedLeases
    if (total === 0) {
      record('stranded-work', 'pass', 'no overdue claims or leases')
    } else {
      record(
        'stranded-work',
        'warn',
        `${strandedClaims} overdue claim(s) + ${strandedLeases} stale-lease step(s) not yet reclaimed — is a poller running? (SLO-3)`,
      )
    }
  } catch {
    record('stranded-work', 'warn', 'could not query (database unreachable)')
  }
}

// ---------------------------------------------------------------------------
// Network checks (skipped with --offline)
// ---------------------------------------------------------------------------

async function checkServer() {
  const base = (process.env.CONDUCTOR_URL || 'http://localhost:3000').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })
    const body = await res.json().catch(() => null)
    if (res.ok && body?.status === 'ok') {
      record('server', 'pass', `${base} healthy (v${body.version})`)
    } else {
      record('server', networkSeverity, `${base} responded ${res.status} (status: ${body?.status ?? 'unknown'})`)
    }
  } catch {
    record('server', networkSeverity, `${base} unreachable — is the app running?`)
  }
}

async function checkRealtimeService() {
  const base = (process.env.AGENTBOARD_WS_URL || 'http://127.0.0.1:3003').replace(/\/$/, '')
  try {
    // board-ws exposes GET /healthz → 200 {status:'ok', connections}. Hit the
    // real health route (not just "any HTTP answer proves it's up"): require
    // 200 + status ok, otherwise the service is reachable but unhealthy.
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) })
    const body = await res.json().catch(() => null)
    if (res.ok && (body?.status === 'ok' || body?.ok === true)) {
      const conns = typeof body?.connections === 'number' ? `, ${body.connections} client(s)` : ''
      record('realtime-service', 'pass', `${base} healthy (HTTP ${res.status}${conns})`)
    } else {
      record(
        'realtime-service',
        networkSeverity,
        `${base} responded ${res.status} but /healthz is not ok (status: ${body?.status ?? 'unknown'})`,
      )
    }
  } catch {
    record(
      'realtime-service',
      networkSeverity,
      `${base} unreachable — realtime disabled, polling fallback active`,
    )
  }
}

// ---------------------------------------------------------------------------
// Daemon E2E smoke (--daemon-e2e, story A-4) — spend-free tracer bullet.
//
// Proves dispatch → lease → payload → spawn-in-workspace-cwd → prompt
// delivery → completion → evidence, using the generic template runner with
// a local bun fixture instead of a real (paid) CLI. Optionally (default on,
// disable with --no-reclaim) also proves B-3: a daemon killed mid-step has
// its lease reclaimed by the stale sweep.
// ---------------------------------------------------------------------------

const E2E_PORT = Number(process.env.SMOKE_PORT || 3111)
const E2E_BASE = `http://127.0.0.1:${E2E_PORT}`
const E2E_STEP_TIMEOUT_MS = 90_000
const E2E_RECLAIM_TIMEOUT_MS = 120_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class SmokeAbort extends Error {}

interface ManagedProc {
  name: string
  proc: ReturnType<typeof Bun.spawn>
  tail: { text: string }
  exited: boolean
}

function spawnLogged(argv: string[], opts: { cwd?: string; env?: Record<string, string>; name: string }): ManagedProc {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const entry: ManagedProc = { name: opts.name, proc, tail: { text: '' }, exited: false }
  const drain = async (stream: ReadableStream<Uint8Array> | null | undefined) => {
    if (!stream) return
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        entry.tail.text = (entry.tail.text + decoder.decode(value)).slice(-6000)
      }
    } catch {
      // stream ends when the process dies — nothing to do
    }
  }
  void drain(proc.stdout as ReadableStream<Uint8Array>)
  void drain(proc.stderr as ReadableStream<Uint8Array>)
  proc.exited.then(() => { entry.exited = true }).catch(() => {})
  return entry
}

/** Kills the whole process tree — `bun run dev` wraps next, which wraps workers. */
function killTree(entry: ManagedProc | null) {
  if (!entry) return
  try {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(entry.proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' })
    } else {
      entry.proc.kill()
    }
  } catch {
    // best effort — cleanup must not throw
  }
}

function runCmd(argv: string[], cwd: string): { ok: boolean; out: string } {
  const res = Bun.spawnSync(argv, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const out = `${res.stdout?.toString() ?? ''}${res.stderr?.toString() ?? ''}`.trim()
  return { ok: res.exitCode === 0, out }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E_BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.status === 'ok') return true
    } catch {
      // not up yet
    }
    await sleep(1500)
  }
  return false
}

async function runDaemonE2E() {
  const runId = Date.now().toString(36)
  const promptMarker = `DAEMON-E2E-PROMPT-MARKER-${runId}`
  const started = Date.now()
  const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`

  let cookieHeader = ''
  const api = async (
    path: string,
    init: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    return fetch(`${E2E_BASE}${path}`, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(init.headers ?? {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  }

  const fail = (name: string, detail: string): never => {
    record(name, 'fail', detail)
    throw new SmokeAbort(detail)
  }

  const password = process.env.AGENTBOARD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
  const internalSecret = process.env.AGENTBOARD_WS_INTERNAL_SECRET
  if (!password) fail('e2e-env', 'AGENTBOARD_ADMIN_PASSWORD is not set (needed to log in) — check .env')
  if (!internalSecret) fail('e2e-env', 'AGENTBOARD_WS_INTERNAL_SECRET is not set (needed to trigger dispatch polls) — check .env')

  // Drives pollAndDispatch (lease DAEMON steps + stale-daemon sweep) without
  // waiting on project automation schedules.
  const pump = async () => {
    try {
      await fetch(`${E2E_BASE}/api/internal/poll-steps`, {
        method: 'POST',
        headers: { 'x-internal-secret': internalSecret! },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      // transient — next pump retries
    }
  }

  let appProc: ManagedProc | null = null
  let daemonProc: ManagedProc | null = null
  let projectId: string | null = null
  let daemonId: string | null = null
  let workspaceDir: string | null = null

  try {
    // -- 1. App boot on a dedicated port -----------------------------------
    if (await waitForHealth(1)) {
      fail('e2e-port', `${E2E_BASE} already responds — another instance is using SMOKE_PORT=${E2E_PORT}; stop it or set SMOKE_PORT`)
    }
    appProc = spawnLogged(['bun', 'run', 'dev'], { env: { PORT: String(E2E_PORT) }, name: 'app' })
    let healthy = await waitForHealth(120_000)
    if (!healthy) {
      // Transient prisma/module races can break a dev boot while other work
      // lands in the repo — wait and retry once before declaring failure.
      killTree(appProc)
      await sleep(30_000)
      appProc = spawnLogged(['bun', 'run', 'dev'], { env: { PORT: String(E2E_PORT) }, name: 'app' })
      healthy = await waitForHealth(120_000)
    }
    if (!healthy) fail('e2e-app-boot', `app never became healthy on ${E2E_BASE} — tail: ${appProc.tail.text.slice(-400)}`)
    record('e2e-app-boot', 'pass', `${E2E_BASE} healthy (${since()})`)

    // -- 2. Admin login ------------------------------------------------------
    const sessionInfo = await (await api('/api/admin/session')).json()
    const loginBody = sessionInfo?.usersExist
      ? { email: process.env.SMOKE_ADMIN_EMAIL || 'owner@conductor.local', password }
      : { password }
    const loginRes = await api('/api/admin/session', { json: loginBody })
    if (!loginRes.ok) {
      fail('e2e-login', `POST /api/admin/session → ${loginRes.status} (usersExist=${sessionInfo?.usersExist}) — set SMOKE_ADMIN_EMAIL if the owner email differs`)
    }
    cookieHeader = (loginRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .filter((pair) => pair.includes('=') && pair.split('=')[1])
      .join('; ')
    if (!cookieHeader) fail('e2e-login', 'login succeeded but no session cookies were set')
    record('e2e-login', 'pass', `admin session established (${since()})`)

    // -- 3. Workspace / project / runtime / agent / task --------------------
    const wsSlug = 'daemon-e2e-smoke'
    let wsRes = await api('/api/workspaces', { json: { name: 'Daemon E2E Smoke', slug: wsSlug } })
    let workspace: { id: string } | undefined
    if (wsRes.status === 409) {
      const list = await (await api('/api/workspaces')).json()
      workspace = (list?.data ?? []).find((w: { slug: string }) => w.slug === wsSlug)
    } else if (wsRes.ok) {
      workspace = await wsRes.json()
    }
    if (!workspace?.id) fail('e2e-workspace', `could not create or find workspace "${wsSlug}" (HTTP ${wsRes.status})`)

    const projRes = await api('/api/projects', {
      json: { name: `Daemon E2E Smoke ${runId}`, description: 'created by bun run smoke:daemon — safe to delete', workspaceId: workspace!.id },
    })
    if (!projRes.ok) fail('e2e-project', `POST /api/projects → ${projRes.status}: ${await projRes.text()}`)
    const project = await projRes.json()
    projectId = project.id as string

    const fixturePath = join(process.cwd(), 'scripts', 'daemon-e2e-fixture.ts')
    if (!existsSync(fixturePath)) fail('e2e-fixture', `fixture missing: ${fixturePath}`)
    if (/\s/.test(fixturePath)) fail('e2e-fixture', `fixture path contains whitespace (commandTemplate is whitespace-split): ${fixturePath}`)
    const runtimeRes = await api(`/api/projects/${projectId}/runtimes`, {
      json: {
        adapter: 'anthropic', // maps to the 'claude-code' runtime → matches the daemon's default capability
        name: 'daemon-e2e-generic',
        models: [{ id: 'smoke-noop', name: 'Smoke Noop (never called)' }],
        config: {
          sessionPolicy: 'ephemeral',
          sessionBackend: 'process',
          workingDirectoryPolicy: 'project-root',
          // Generic template runner: argv = whitespace-split, prompt on stdin.
          commandTemplate: `bun ${fixturePath}`,
        },
      },
    })
    if (!runtimeRes.ok) fail('e2e-runtime', `POST runtimes → ${runtimeRes.status}: ${await runtimeRes.text()}`)
    const runtime = await runtimeRes.json()

    const agentRes = await api('/api/agents', {
      json: {
        name: 'Daemon E2E Agent',
        projectId,
        role: 'developer',
        runtimeId: runtime.id,
        invocationMode: 'DAEMON',
        supportedModes: ['develop'],
        systemPrompt: `${promptMarker}\nYou are the daemon e2e smoke agent. This prompt is delivered to a local fixture CLI; no LLM is ever called.`,
      },
    })
    if (!agentRes.ok) fail('e2e-agent', `POST /api/agents → ${agentRes.status}: ${await agentRes.text()}`)
    const agent = await agentRes.json()

    const taskRes = await api('/api/tasks', {
      json: {
        title: `Daemon e2e smoke ${runId}`,
        description: 'Tracer-bullet smoke task (A-4). The fixture CLI writes smoke-output.md into the workspace.',
        projectId,
        steps: [{
          mode: 'develop', // write-capable → CONDUCTOR_STEP_POLICY=write for the generic runner
          agentId: agent.id,
          instructions: `DAEMON-E2E-STEP-${runId}: write the smoke output file.`,
          maxRetries: 0,
          timeoutMs: 60_000,
          autoContinue: true,
        }],
      },
    })
    if (!taskRes.ok) fail('e2e-task', `POST /api/tasks → ${taskRes.status}: ${await taskRes.text()}`)
    const task = await taskRes.json()
    record('e2e-fixture-setup', 'pass', `workspace/project/runtime/agent/task created (task ${task.id}, ${since()})`)

    // -- 4. Temp workspace dir with a git repo ------------------------------
    workspaceDir = mkdtempSync(join(tmpdir(), 'conductor-daemon-e2e-'))
    const git = (...argv: string[]) => runCmd(['git', '-c', 'user.email=smoke@conductor.local', '-c', 'user.name=DaemonSmoke', '-c', 'commit.gpgsign=false', ...argv], workspaceDir!)
    const init = git('init')
    if (!init.ok) fail('e2e-git', `git init failed: ${init.out}`)
    await Bun.write(join(workspaceDir, 'README.md'), `# daemon e2e workspace ${runId}\n`)
    const add = git('add', 'README.md')
    const commit = add.ok ? git('commit', '-m', 'init') : add
    if (!commit.ok) fail('e2e-git', `git commit failed: ${commit.out}`)
    record('e2e-workspace-dir', 'pass', `${workspaceDir} (git repo, 1 commit)`)

    // -- 5. Register + start the reference daemon ---------------------------
    const regRes = await api('/api/daemon/register', {
      json: {
        hostname: `daemon-e2e-${runId}`,
        platform: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
        version: '0.0.0-smoke',
        // Registers exactly like the reference daemon does (one capability —
        // mini-services/conductor-daemon/index.ts). KNOWN BUG: this currently
        // 400s because registerDaemonSchema's `capabilities` uses zod-v4
        // z.record(z.enum(...)), which requires ALL enum keys; it needs
        // z.partialRecord (src/lib/server/daemon-contracts.ts). The smoke
        // fails here by design until that one-line fix lands — padding the
        // payload with fake codex/copilot capabilities would mask the bug.
        capabilities: { 'claude-code': { version: 'smoke' } },
        workspaceId: workspace!.id,
      },
    })
    if (!regRes.ok) fail('e2e-daemon-register', `POST /api/daemon/register → ${regRes.status}: ${await regRes.text()}`)
    const registration = await regRes.json()
    daemonId = registration.daemonId as string

    daemonProc = spawnLogged(['bun', 'index.ts'], {
      cwd: join(process.cwd(), 'mini-services', 'conductor-daemon'),
      name: 'daemon',
      env: {
        CONDUCTOR_URL: E2E_BASE,
        CONDUCTOR_DAEMON_TOKEN: registration.token,
        DAEMON_WORKSPACE_ROOT: workspaceDir,
        DAEMON_POLL_INTERVAL_MS: '1000',
        DAEMON_RUNNER: '', // unset → generic template runner (commandTemplate is configured)
      },
    })
    record('e2e-daemon-start', 'pass', `daemon ${daemonId} registered + started (${since()})`)

    // -- 6. Drive dispatch and wait for completion ---------------------------
    const stepDeadline = Date.now() + E2E_STEP_TIMEOUT_MS
    let step: Record<string, unknown> | null = null
    while (Date.now() < stepDeadline) {
      await pump()
      const steps = await (await api(`/api/tasks/${task.id}/steps`)).json()
      step = Array.isArray(steps) ? steps[0] : null
      if (step && (step.status === 'done' || step.status === 'failed')) break
      if (daemonProc.exited) fail('e2e-step-completed', `daemon exited prematurely — tail: ${daemonProc.tail.text.slice(-400)}`)
      await sleep(2000)
    }
    if (!step || step.status !== 'done') {
      fail(
        'e2e-step-completed',
        `step status "${step?.status ?? 'unknown'}" after ${since()} (error: ${step?.error ?? 'n/a'}) — daemon tail: ${daemonProc.tail.text.slice(-400)}`,
      )
    }
    record('e2e-step-completed', 'pass', `step done in ${since()}`)

    // -- 7. Assertions --------------------------------------------------------
    const taskAfter = await (await api(`/api/tasks/${task.id}`)).json()
    if (taskAfter.status === 'DONE') record('e2e-task-status', 'pass', 'task resolved to DONE (all steps done — resolveTaskStatus)')
    else record('e2e-task-status', 'fail', `expected task DONE, got ${taskAfter.status}`)

    const outputFile = join(workspaceDir, 'smoke-output.md')
    if (!existsSync(outputFile)) {
      record('e2e-workspace-file', 'fail', `smoke-output.md missing in ${workspaceDir} — cwd or prompt delivery broken`)
    } else {
      const content = readFileSync(outputFile, 'utf8')
      if (content.includes(promptMarker)) {
        record('e2e-workspace-file', 'pass', 'smoke-output.md exists in the temp workspace and contains the system-prompt marker (cwd + stdin prompt delivery proven)')
      } else {
        record('e2e-workspace-file', 'fail', `smoke-output.md exists but lacks marker ${promptMarker}: ${content.slice(0, 200)}`)
      }
    }

    const stepOutput = String(step!.output ?? '')
    if (stepOutput.includes('SMOKE-FIXTURE-OK') && stepOutput.includes('policy=write')) {
      record('e2e-step-output', 'pass', 'step output carries the fixture stdout (incl. CONDUCTOR_STEP_POLICY=write)')
    } else {
      record('e2e-step-output', 'fail', `step output missing fixture line: ${stepOutput.slice(0, 300)}`)
    }

    const artifacts = await (await api(`/api/tasks/${task.id}/steps/${step!.id}/artifacts`)).json()
    const diffArtifact = (Array.isArray(artifacts) ? artifacts : []).find(
      (a: { type: string; label: string }) => a.type === 'diff' && a.label === 'git diff --stat',
    )
    const dirtyFiles = diffArtifact ? Number(JSON.parse(diffArtifact.metadata || '{}').dirtyFiles ?? 0) : 0
    if (diffArtifact && dirtyFiles >= 1) {
      // A-3 semantics: the new file is UNTRACKED, so `git diff --stat` is empty;
      // the evidence is metadata.dirtyFiles from `git status --porcelain`.
      record('e2e-git-evidence', 'pass', `diff artifact attached; metadata.dirtyFiles=${dirtyFiles} (untracked smoke-output.md counted)`)
    } else {
      record('e2e-git-evidence', 'fail', diffArtifact ? `diff artifact present but dirtyFiles=${dirtyFiles}` : `no 'git diff --stat' artifact on the step (got: ${JSON.stringify(artifacts).slice(0, 200)})`)
    }

    const evidence = await (await api(`/api/tasks/${task.id}/steps/${step!.id}/evidence`)).json()
    const eventNames = (evidence?.events ?? []).map((e: { event: string }) => e.event)
    const sessions = await (await api(`/api/sessions?taskId=${task.id}`)).json()
    const session = (sessions?.sessions ?? [])[0]
    const sessionHasOutput = Boolean(session?.outputPreview && String(session.outputPreview).includes('SMOKE-FIXTURE-OK'))
    if (eventNames.includes('started') && eventNames.includes('succeeded') && session && sessionHasOutput) {
      record('e2e-session-events', 'pass', `step events [${eventNames.join(', ')}]; session ${session.id} recorded streamed output events`)
    } else {
      record('e2e-session-events', 'fail', `events=[${eventNames.join(', ')}], session=${session ? session.id : 'none'}, outputPreview match=${sessionHasOutput}`)
    }

    // -- 8. Optional: kill daemon mid-run → stale sweep reclaims the lease (B-3)
    if (!SKIP_RECLAIM) {
      const task2Res = await api('/api/tasks', {
        json: {
          title: `Daemon e2e reclaim ${runId}`,
          description: 'Lease-reclaim scenario: the fixture sleeps, the daemon is killed mid-run.',
          projectId,
          steps: [{
            mode: 'develop',
            agentId: agent.id,
            instructions: `DAEMON-E2E-SLEEP-600000 — sleep so the daemon can be killed mid-step.`,
            maxRetries: 0,
            timeoutMs: 600_000,
          }],
        },
      })
      if (!task2Res.ok) fail('e2e-lease-reclaimed', `reclaim task creation failed: ${task2Res.status}`)
      const task2 = await task2Res.json()

      // Wait until the daemon has actually leased + started the step.
      const pickupDeadline = Date.now() + 60_000
      let leased = false
      while (Date.now() < pickupDeadline) {
        await pump()
        const steps2 = await (await api(`/api/tasks/${task2.id}/steps`)).json()
        const s = Array.isArray(steps2) ? steps2[0] : null
        const sess2 = await (await api(`/api/sessions?taskId=${task2.id}`)).json()
        if (s?.leasedBy === daemonId && (sess2?.sessions ?? []).length > 0) { leased = true; break }
        await sleep(2000)
      }
      if (!leased) {
        record('e2e-lease-reclaimed', 'fail', 'daemon never picked up the reclaim step within 60s')
      } else {
        killTree(daemonProc)
        daemonProc = null
        // Keep pumping: each poll runs the throttled stale sweep; after ~30s of
        // missed heartbeats the daemon flips stale and B-3 reclaims its lease.
        const reclaimStart = Date.now()
        let reclaimed = false
        while (Date.now() - reclaimStart < E2E_RECLAIM_TIMEOUT_MS) {
          await pump()
          const steps2 = await (await api(`/api/tasks/${task2.id}/steps`)).json()
          const s = Array.isArray(steps2) ? steps2[0] : null
          if (s && s.leasedBy === null && s.status === 'active') { reclaimed = true; break }
          await sleep(2000)
        }
        if (reclaimed) {
          const activity = await (await api(`/api/activity?projectId=${projectId}&search=lease_reclaimed&limit=20`)).json()
          const entries = Array.isArray(activity?.data) ? activity.data : Array.isArray(activity) ? activity : (activity?.logs ?? [])
          record(
            'e2e-lease-reclaimed',
            'pass',
            `lease released ${((Date.now() - reclaimStart) / 1000).toFixed(0)}s after daemon kill (stale sweep, B-3); lease_reclaimed activity rows: ${entries.length}`,
          )
        } else {
          record('e2e-lease-reclaimed', 'fail', `step still leased ${E2E_RECLAIM_TIMEOUT_MS / 1000}s after daemon kill`)
        }
      }
    }
  } catch (err) {
    if (!(err instanceof SmokeAbort)) {
      record('daemon-e2e', 'fail', `unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!JSON_OUT) {
      if (appProc?.tail.text) console.error(`\n--- app tail ---\n${appProc.tail.text.slice(-1500)}`)
      if (daemonProc?.tail.text) console.error(`\n--- daemon tail ---\n${daemonProc.tail.text.slice(-1500)}`)
    }
  } finally {
    // Cleanup: delete the project via API while the app is still up (cascades
    // tasks/steps/agents/runtimes/activity), then kill processes, then local FS
    // and daemon rows so repeated runs don't accumulate.
    if (projectId) {
      try {
        const del = await api(`/api/projects/${projectId}`, { method: 'DELETE' })
        record('e2e-cleanup-project', del.ok ? 'pass' : 'warn', del.ok ? 'project deleted (cascade)' : `DELETE → ${del.status}`)
      } catch (err) {
        record('e2e-cleanup-project', 'warn', `project delete failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    killTree(daemonProc)
    killTree(appProc)
    if (workspaceDir) {
      try { rmSync(workspaceDir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
    if (daemonId) {
      // No API exists to delete a daemon registration, and the prisma client
      // cannot load better-sqlite3 under bun — use bun:sqlite directly so
      // repeated runs don't accumulate throwaway daemon/session rows.
      // (Postgres deployments: rows are left behind; they go stale/offline.)
      const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db'
      if (dbUrl.startsWith('file:')) {
        try {
          const { Database } = await import('bun:sqlite')
          const sqlite = new Database(join(process.cwd(), dbUrl.replace(/^file:(\.\/)?/, '')))
          sqlite.run('DELETE FROM AgentSession WHERE daemonId = ?', [daemonId])
          sqlite.run('DELETE FROM Daemon WHERE id = ?', [daemonId])
          sqlite.close()
        } catch { /* daemon row may already be gone */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const ICONS: Record<Severity, string> = { pass: '✓', warn: '!', fail: '✗' }

async function main() {
  if (DAEMON_E2E) {
    await runDaemonE2E()
  } else {
    checkRuntime()
    checkEnvFile()
    checkEnvValidation()
    checkPrismaClient()
    await checkDatabase()
    await checkRuntimes()
    await checkDaemons()
    await checkStranded()

    if (!OFFLINE) {
      await checkServer()
      await checkRealtimeService()
    }
  }

  const failed = results.filter((r) => r.severity === 'fail')
  const warned = results.filter((r) => r.severity === 'warn')

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          mode: DAEMON_E2E ? 'daemon-e2e' : SMOKE ? 'smoke' : OFFLINE ? 'offline' : 'default',
          checks: results,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`conductor doctor${DAEMON_E2E ? ' (daemon e2e smoke)' : OFFLINE ? ' (offline)' : SMOKE ? ' (smoke test)' : ''}\n`)
    for (const r of results) {
      console.log(`  ${ICONS[r.severity]} ${r.name.padEnd(18)} ${r.detail}`)
    }
    console.log(
      `\n${failed.length === 0 ? 'OK' : 'FAILED'} — ${results.length} checks, ${failed.length} failed, ${warned.length} warnings`,
    )
  }

  process.exit(failed.length === 0 ? 0 : 1)
}

main()
  .catch((err) => {
    console.error('doctor crashed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect().catch(() => {}))
