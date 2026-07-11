/**
 * Step runner — turns a leased step's Execution Payload into a real OS
 * process, per the verified invocation contract of SPIKE A-0
 * (docs/gpm/state/spike-a0-headless-cli.md).
 *
 * Non-negotiables (spike findings + EPIC A DoD):
 *   - spawn with an argument array and `shell: false`; instructions are
 *     NEVER interpolated into a shell string
 *   - instructions always ride stdin (no arg-length ceiling, nothing in the
 *     process list, nothing shell-parsed)
 *   - system prompt rides a runner-owned temp file via
 *     `--append-system-prompt-file` (fallback: `--append-system-prompt` arg
 *     for prompts < 8KB); the temp file is deleted after the run
 *   - exit 0 with `is_error: true` in the final stream-json result line is
 *     still a FAILURE (spike finding, exit-codes table)
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

// ---------------------------------------------------------------------------
// Execution Payload (payloadVersion 2) — mirrors GET /api/daemon/steps/next
// v2 (G1-1-T3): instructions + agent.systemPrompt arrive server-RESOLVED (no
// `{{tokens}}`), and `previousOutput` carries the prior step's output.
// ---------------------------------------------------------------------------

export interface SessionBlock {
  policy: string
  backend: string
  sessionKey: string
  /** Server-resolved command template (generic runner) — argv source. */
  command: string | null
  /** Loud server-side rejection (e.g. unknown template tokens). Never run when set. */
  commandError?: string | null
  /** 'project-root' | 'task-dir' | 'daemon-default' — resolved by workspace.ts. */
  workingDirectoryPolicy?: string | null
  maxOutputPreviewChars: number
}

export interface ExecutionPayload {
  payloadVersion?: number
  id: string
  taskId: string
  mode: string
  instructions: string | null
  /** Prior step's output (v2) — chain context for a mid-chain daemon step. */
  previousOutput?: string | null
  timeoutMs: number | null
  session: SessionBlock
  agent: {
    id: string
    name: string
    systemPrompt?: string | null
    /** JSON string: Record<mode, instructions> */
    modeInstructions?: string | null
    runtimeModel?: string | null
  } | null
  task: { id: string; title: string; description?: string | null }
}

export const EXECUTION_PAYLOAD_VERSION = 2

/**
 * Contract guard, both directions: the server route test asserts its response
 * passes this; the daemon refuses (loudly fails the step) when it does not.
 * Returns a list of problems; empty means the payload is runnable.
 */
export function validateExecutionPayload(value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return ['payload is not an object']
  const p = value as Record<string, unknown>

  if (p.payloadVersion !== EXECUTION_PAYLOAD_VERSION) {
    problems.push(`payloadVersion must be ${EXECUTION_PAYLOAD_VERSION} (got ${JSON.stringify(p.payloadVersion)})`)
  }
  for (const field of ['id', 'taskId', 'mode'] as const) {
    if (typeof p[field] !== 'string' || p[field] === '') problems.push(`${field} must be a non-empty string`)
  }
  if (p.instructions !== null && typeof p.instructions !== 'string') {
    problems.push('instructions must be a string or null')
  }
  if (p.previousOutput !== undefined && p.previousOutput !== null && typeof p.previousOutput !== 'string') {
    problems.push('previousOutput must be a string, null, or absent')
  }
  const session = p.session as Record<string, unknown> | null | undefined
  if (typeof session !== 'object' || session === null) {
    problems.push('session block missing')
  } else {
    if (typeof session.sessionKey !== 'string') problems.push('session.sessionKey must be a string')
    if (typeof session.backend !== 'string') problems.push('session.backend must be a string')
  }
  const task = p.task as Record<string, unknown> | null | undefined
  if (typeof task !== 'object' || task === null) {
    problems.push('task block missing')
  } else if (typeof task.id !== 'string' || typeof task.title !== 'string') {
    problems.push('task.id and task.title must be strings')
  }
  const agent = p.agent as Record<string, unknown> | null | undefined
  if (agent !== null && agent !== undefined) {
    if (typeof agent !== 'object') {
      problems.push('agent must be an object or null')
    } else if (typeof agent.id !== 'string' || typeof agent.name !== 'string') {
      problems.push('agent.id and agent.name must be strings')
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Runner selection — real execution is opt-in, echo stays the safety default
// ---------------------------------------------------------------------------

export type RunnerKind = 'claude' | 'template' | 'echo'

/**
 * `DAEMON_RUNNER=claude` opts into the claude runner. A server-configured
 * commandTemplate opts into the generic template runner. Otherwise the
 * no-op echo runner proves the protocol without executing anything real.
 * Unknown values throw — validate at startup, not mid-step.
 */
export function resolveRunnerKind(daemonRunnerEnv: string | undefined, hasCommand: boolean): RunnerKind {
  const value = (daemonRunnerEnv ?? '').trim()
  if (value === 'claude') return 'claude'
  if (value === 'echo') return 'echo'
  if (value === '') return hasCommand ? 'template' : 'echo'
  throw new Error(`DAEMON_RUNNER must be "claude", "echo", or unset — got "${value}"`)
}

// ---------------------------------------------------------------------------
// Command template → argv (generic runner)
// ---------------------------------------------------------------------------

/** Tokens the server resolves into `session.command` (server-owned scalars only). */
export const TEMPLATE_TOKEN_WHITELIST = ['agent.runtimeModel', 'task.id', 'step.id', 'step.mode'] as const

export class TemplateTokenError extends Error {
  constructor(public readonly tokens: string[]) {
    super(
      `command template references unknown tokens: ${tokens.join(', ')} ` +
        `(allowed: ${TEMPLATE_TOKEN_WHITELIST.join(', ')})`,
    )
    this.name = 'TemplateTokenError'
  }
}

const TOKEN_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g

/**
 * Splits a server-resolved command into an argv array. The server substitutes
 * whitelisted tokens before sending; any `{{token}}` still present is unknown
 * and must fail loudly — an unresolved token must never reach a process, and
 * silently dropping it would run a mangled command.
 */
export function commandToArgv(command: string): string[] {
  const residual = [...command.matchAll(TOKEN_PATTERN)].map((m) => m[1])
  if (residual.length > 0) throw new TemplateTokenError(residual)
  const argv = command.trim().split(/\s+/).filter(Boolean)
  if (argv.length === 0) throw new Error('command template resolved to an empty command')
  return argv
}

// ---------------------------------------------------------------------------
// Payload composition
// ---------------------------------------------------------------------------

/** agent.systemPrompt + modeInstructions[step.mode] (matches HTTP dispatch layering). */
export function composeSystemPrompt(payload: ExecutionPayload): string {
  const parts: string[] = []
  if (payload.agent?.systemPrompt) parts.push(payload.agent.systemPrompt)
  if (payload.agent?.modeInstructions) {
    try {
      const byMode = JSON.parse(payload.agent.modeInstructions) as Record<string, string>
      const forMode = byMode?.[payload.mode]
      if (typeof forMode === 'string' && forMode.trim()) parts.push(forMode)
    } catch {
      // modeInstructions is best-effort context — a broken JSON string must
      // not block execution of an otherwise valid step.
    }
  }
  return parts.join('\n\n').trim()
}

/** Task context + step instructions — the stdin body (spike §3 stdin protocol).
 *  v2: prepends the previous step's output as chain context (parity with the
 *  HTTP path, which passes previousOutput to the adapter). */
export function composeInstructions(payload: ExecutionPayload): string {
  return [
    `Task: ${payload.task.title}`,
    payload.task.description ? `Description: ${payload.task.description}` : '',
    payload.previousOutput ? `Previous Step Output:\n${payload.previousOutput}` : '',
    payload.instructions ? `Step Instructions: ${payload.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Spawn specs
// ---------------------------------------------------------------------------

export interface SpawnSpec {
  kind: RunnerKind
  /** argv[0] is the binary; spawned with shell: false, never joined. */
  argv: string[]
  /** Written to the child's stdin in one write, then stdin is closed. */
  stdin: string
  /** Extra environment for the child (merged over process.env). */
  env?: Record<string, string>
  /** Safe, prompt-free summary for session events / logs. */
  summary: string
  /** Removes runner-owned temp files. Always called after the run. */
  cleanup: () => void
}

/**
 * Effective execution policy of a step, derived from its mode (A-2 policy
 * guard). Only the explicitly write-capable modes get `write`; anything
 * unknown or custom stays `readOnly` — deny by default.
 */
export type StepPolicy = 'readOnly' | 'write'

const WRITE_CAPABLE_STEP_MODES = new Set(['develop', 'draft'])

export function stepPolicyForMode(mode: string): StepPolicy {
  return WRITE_CAPABLE_STEP_MODES.has(mode) ? 'write' : 'readOnly'
}

/**
 * Claude CLI permission modes that can mutate the workspace. A readOnly step
 * policy must never produce one of these (AC: "Given a policy readOnly, the
 * runner refuses write-mode invocation").
 */
const WRITE_CAPABLE_PERMISSION_MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk'])

/** step.mode → CLI permission mode, derived from the step policy. */
export function mapStepModeToPermissionMode(mode: string): 'acceptEdits' | 'plan' {
  return stepPolicyForMode(mode) === 'write' ? 'acceptEdits' : 'plan'
}

export interface ClaudeRunnerOptions {
  /** Binary (and any fixed leading args) — default ['claude']. Tests point this at a fake CLI. */
  binArgv?: string[]
  /** --max-turns ceiling. Default 30 (spike §3). */
  maxTurns?: number
  /**
   * 'file' (default): system prompt via temp file + --append-system-prompt-file.
   * 'arg': inline --append-system-prompt when < 8KB (falls back to file above that).
   */
  systemPromptMode?: 'file' | 'arg'
  /** Where temp system-prompt files live. Default: OS temp dir. */
  tempDir?: string
}

const SYSTEM_PROMPT_ARG_LIMIT_BYTES = 8 * 1024

export function buildClaudeSpawnSpec(payload: ExecutionPayload, opts: ClaudeRunnerOptions = {}): SpawnSpec {
  const binArgv = opts.binArgv ?? ['claude']
  const maxTurns = opts.maxTurns ?? 30

  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
  ]

  const systemPrompt = composeSystemPrompt(payload)
  const tempFiles: string[] = []
  if (systemPrompt) {
    const inlineOk =
      opts.systemPromptMode === 'arg' && Buffer.byteLength(systemPrompt, 'utf8') < SYSTEM_PROMPT_ARG_LIMIT_BYTES
    if (inlineOk) {
      args.push('--append-system-prompt', systemPrompt)
    } else {
      const dir = opts.tempDir ?? tmpdir()
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `conductor-sysprompt-${payload.id}-${randomUUID()}.md`)
      writeFileSync(file, systemPrompt, 'utf8')
      tempFiles.push(file)
      args.push('--append-system-prompt-file', file)
    }
  }

  if (payload.agent?.runtimeModel) args.push('--model', payload.agent.runtimeModel)
  args.push('--max-turns', String(maxTurns))

  // Policy guard (A-2): the mapping above keeps readOnly → 'plan' by
  // construction; this refusal is belt-and-braces so a future mapping edit
  // can never silently hand a read-only step a write-capable CLI.
  const permissionMode = mapStepModeToPermissionMode(payload.mode)
  if (stepPolicyForMode(payload.mode) === 'readOnly' && WRITE_CAPABLE_PERMISSION_MODES.has(permissionMode)) {
    throw new Error(
      `policy violation: readOnly step mode "${payload.mode}" mapped to write-capable permission mode "${permissionMode}"`,
    )
  }
  args.push('--permission-mode', permissionMode)

  const argv = [...binArgv, ...args]
  return {
    kind: 'claude',
    argv,
    stdin: composeInstructions(payload),
    summary: argv
      .map((arg, i) => (argv[i - 1] === '--append-system-prompt' ? '[system-prompt]' : arg))
      .join(' ')
      .slice(0, 500),
    cleanup: () => {
      for (const file of tempFiles) {
        try {
          rmSync(file, { force: true })
        } catch {
          // best effort — a leaked temp file must not fail the step
        }
      }
    },
  }
}

/**
 * Generic runner: server-resolved commandTemplate → argv, spawned shell-less.
 * Generic CLIs have no system-prompt channel, so the full composed prompt
 * (system prompt + instructions) rides stdin (spike §2.10).
 */
export function buildTemplateSpawnSpec(payload: ExecutionPayload): SpawnSpec {
  if (!payload.session.command) throw new Error('template runner requires session.command')
  const argv = commandToArgv(payload.session.command)
  const systemPrompt = composeSystemPrompt(payload)
  const stdin = [systemPrompt, composeInstructions(payload)].filter(Boolean).join('\n\n')
  return {
    kind: 'template',
    argv,
    stdin,
    // Generic CLIs have no --permission-mode; expose the step policy as an
    // env var so custom CLIs can honor readOnly steps (A-2 policy guard).
    env: { CONDUCTOR_STEP_POLICY: stepPolicyForMode(payload.mode) },
    summary: argv.join(' ').slice(0, 500),
    cleanup: () => {},
  }
}

/**
 * SAFETY DEFAULT: no-op echo runner — proves the protocol without executing
 * anything. Runs via the daemon's own bun binary (`bun -e`), so not even the
 * echo path touches a shell; the summary travels as an env var, never as
 * parsed code.
 */
export function buildEchoSpawnSpec(payload: ExecutionPayload): SpawnSpec {
  const summary = `conductor-daemon echo runner: step ${payload.id} (${payload.mode}) of task "${payload.task.title}"`
  return {
    kind: 'echo',
    argv: [process.execPath, '-e', 'process.stdout.write(process.env.CONDUCTOR_ECHO_SUMMARY ?? "")'],
    stdin: '',
    env: { CONDUCTOR_ECHO_SUMMARY: summary },
    summary: summary.slice(0, 500),
    cleanup: () => {},
  }
}

export function buildSpawnSpec(
  kind: RunnerKind,
  payload: ExecutionPayload,
  claudeOpts: ClaudeRunnerOptions = {},
): SpawnSpec {
  switch (kind) {
    case 'claude':
      return buildClaudeSpawnSpec(payload, claudeOpts)
    case 'template':
      return buildTemplateSpawnSpec(payload)
    case 'echo':
      return buildEchoSpawnSpec(payload)
  }
}

// ---------------------------------------------------------------------------
// Process execution
// ---------------------------------------------------------------------------

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  timeoutMs: number
  env?: Record<string, string>
  /**
   * REQUIRED, absolute — the step's resolved workspace directory (A-2).
   * There is deliberately no default: falling back to the daemon's own
   * process.cwd() would execute a headless CLI (which skips the trust
   * dialog) in an unintended directory.
   */
  cwd: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/**
 * Spawns the spec (argument array, shell: false) in the resolved workspace
 * cwd, writes the prompt to stdin in a single write, closes stdin, and
 * captures output. Daemon-side timeout kills the child and reports the
 * existing 124 convention; spawn errors report 127. Temp files are cleaned
 * up in finally.
 */
export async function runSpawnSpec(spec: SpawnSpec, opts: RunOptions): Promise<ProcessResult> {
  try {
    // SECURITY (A-2): never spawn without an explicit absolute workspace cwd.
    if (!opts.cwd || !isAbsolute(opts.cwd)) {
      throw new Error(
        `runSpawnSpec requires an absolute cwd (got ${JSON.stringify(opts.cwd || null)}) — ` +
          `the runner never executes in the daemon's own working directory`,
      )
    }
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      shell: false,
      cwd: opts.cwd,
      env: { ...process.env, ...spec.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      opts.onStdout?.(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      opts.onStderr?.(text)
    })

    // A fast-exiting child can close the pipe before the write lands (EPIPE).
    child.stdin?.on('error', () => {})
    child.stdin?.write(spec.stdin)
    child.stdin?.end()

    const exitCode: number = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
        resolve(124)
      }, opts.timeoutMs)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code ?? 1)
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(127)
      })
    })

    return { exitCode, stdout, stderr, timedOut }
  } finally {
    spec.cleanup()
  }
}

// ---------------------------------------------------------------------------
// Result interpretation
// ---------------------------------------------------------------------------

export interface ClaudeResultLine {
  isError: boolean
  subtype?: string
  result?: string
  totalCostUsd?: number
  sessionId?: string
  numTurns?: number
}

/** Last `"type":"result"` NDJSON line on stdout — the authoritative outcome. */
export function parseClaudeResultLine(stdout: string): ClaudeResultLine | null {
  const lines = stdout.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (obj.type !== 'result') continue
      return {
        isError: obj.is_error === true,
        subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
        result: typeof obj.result === 'string' ? obj.result : undefined,
        totalCostUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
        sessionId: typeof obj.session_id === 'string' ? obj.session_id : undefined,
        numTurns: typeof obj.num_turns === 'number' ? obj.num_turns : undefined,
      }
    } catch {
      continue
    }
  }
  return null
}

export interface StepRunOutcome {
  ok: boolean
  exitCode: number
  /** What to report as step output on success. */
  output: string
  /** Failure message (includes the stderr tail) on failure. */
  error: string | null
  /** Claude-specific enrichment (cost, session id) when kind === 'claude'. */
  claude: ClaudeResultLine | null
}

const TAIL_CHARS = 500

/**
 * Failure semantics:
 *   - non-zero exit (incl. 124 timeout, 127 spawn error) → failure with stderr tail
 *   - claude runner: no final result line → failure; `is_error: true` → failure
 *     even on exit 0 (spike finding — exit code alone is not authoritative)
 */
export function interpretResult(kind: RunnerKind, proc: ProcessResult): StepRunOutcome {
  const tail = (proc.stderr.trim() || proc.stdout.trim()).slice(-TAIL_CHARS)

  if (proc.exitCode !== 0) {
    const reason = proc.timedOut ? ` (daemon timeout)` : ''
    return {
      ok: false,
      exitCode: proc.exitCode,
      output: proc.stdout,
      error: `exit code ${proc.exitCode}${reason}: ${tail}`,
      claude: null,
    }
  }

  if (kind === 'claude') {
    const line = parseClaudeResultLine(proc.stdout)
    if (!line) {
      return {
        ok: false,
        exitCode: proc.exitCode,
        output: proc.stdout,
        error: `claude exited 0 but emitted no final result line: ${tail}`,
        claude: null,
      }
    }
    if (line.isError) {
      const detail = (line.result ?? line.subtype ?? 'unknown error').slice(-TAIL_CHARS)
      return {
        ok: false,
        exitCode: proc.exitCode,
        output: proc.stdout,
        error: `claude reported is_error=true (${line.subtype ?? 'error'}): ${detail}`,
        claude: line,
      }
    }
    return { ok: true, exitCode: proc.exitCode, output: line.result ?? '', error: null, claude: line }
  }

  return { ok: true, exitCode: proc.exitCode, output: proc.stdout, error: null, claude: null }
}
