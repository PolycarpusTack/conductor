/**
 * Conductor doctor — verifies a deployment end to end.
 *
 *   bun run doctor                  local checks + lenient network checks
 *   bun run doctor --offline        local checks only (CI mode)
 *   bun run smoke-test              network checks must PASS (post-deploy gate)
 *   ... --json                      machine-readable output
 *
 * Exit code 1 iff any check FAILS. Network checks are warn-level by default
 * (the board runs fine on polling without the realtime service) and promoted
 * to fail under --smoke.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { db } from '../src/lib/db'
import { validateEnv } from '../src/lib/env'

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
    // board-ws has no health route; ANY HTTP answer (e.g. 401 on an
    // unauthenticated broadcast) proves the service is up.
    const res = await fetch(`${base}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    record('realtime-service', 'pass', `${base} reachable (HTTP ${res.status})`)
  } catch {
    record(
      'realtime-service',
      SMOKE ? 'fail' : 'warn',
      `${base} unreachable — realtime disabled, polling fallback active`,
    )
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const ICONS: Record<Severity, string> = { pass: '✓', warn: '!', fail: '✗' }

async function main() {
  checkRuntime()
  checkEnvFile()
  checkEnvValidation()
  checkPrismaClient()
  await checkDatabase()
  await checkRuntimes()
  await checkDaemons()

  if (!OFFLINE) {
    await checkServer()
    await checkRealtimeService()
  }

  const failed = results.filter((r) => r.severity === 'fail')
  const warned = results.filter((r) => r.severity === 'warn')

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { ok: failed.length === 0, mode: SMOKE ? 'smoke' : OFFLINE ? 'offline' : 'default', checks: results },
        null,
        2,
      ),
    )
  } else {
    console.log(`conductor doctor${OFFLINE ? ' (offline)' : SMOKE ? ' (smoke test)' : ''}\n`)
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
