import { describe, test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TemplateTokenError,
  buildClaudeSpawnSpec,
  buildEchoSpawnSpec,
  buildTemplateSpawnSpec,
  commandToArgv,
  composeInstructions,
  composeSystemPrompt,
  interpretResult,
  mapStepModeToPermissionMode,
  parseClaudeResultLine,
  resolveRunnerKind,
  runSpawnSpec,
  stepPolicyForMode,
  validateExecutionPayload,
  type ExecutionPayload,
  type SpawnSpec,
} from './runner'

const FAKE_CLI = join(import.meta.dir, 'test-fixtures', 'fake-cli.ts')
// process.execPath is the bun binary that runs this test — no shell involved.
const FAKE_BIN = [process.execPath, FAKE_CLI]

// Every spawn needs an explicit workspace cwd (A-2) — a real directory the
// fake CLI can start in, standing in for the daemon's mapped workspace.
const TEST_WORKSPACE = mkdtempSync(join(tmpdir(), 'conductor-runner-ws-'))
process.on('exit', () => rmSync(TEST_WORKSPACE, { recursive: true, force: true }))

function payload(overrides: Partial<ExecutionPayload> = {}): ExecutionPayload {
  return {
    payloadVersion: 2,
    id: 'step-1',
    taskId: 'task-1',
    mode: 'develop',
    instructions: 'Implement the calendar view.',
    timeoutMs: 60_000,
    session: {
      policy: 'ephemeral',
      backend: 'process',
      sessionKey: 'step-step-1',
      command: null,
      commandError: null,
      maxOutputPreviewChars: 5000,
    },
    agent: {
      id: 'agent-1',
      name: 'Builder',
      systemPrompt: 'You are Builder, a careful engineer.',
      modeInstructions: JSON.stringify({ develop: 'Write production-grade code.' }),
      runtimeModel: 'claude-sonnet-4-5',
    },
    task: { id: 'task-1', title: 'Build calendar', description: 'A month grid.' },
    ...overrides,
  }
}

function argAfter(spec: SpawnSpec, flag: string): string | undefined {
  const idx = spec.argv.indexOf(flag)
  return idx === -1 ? undefined : spec.argv[idx + 1]
}

async function runClaude(
  p: ExecutionPayload,
  opts: { env?: Record<string, string>; timeoutMs?: number; systemPromptMode?: 'file' | 'arg'; cwd?: string } = {},
) {
  const spec = buildClaudeSpawnSpec(p, {
    binArgv: FAKE_BIN,
    systemPromptMode: opts.systemPromptMode ?? 'file',
  })
  const proc = await runSpawnSpec(spec, {
    timeoutMs: opts.timeoutMs ?? 20_000,
    env: opts.env,
    cwd: opts.cwd ?? TEST_WORKSPACE,
  })
  return { spec, proc, outcome: interpretResult('claude', proc) }
}

/** The fake CLI reports what it received inside the result string. */
function fakeReport(outcome: { output: string }) {
  return JSON.parse(outcome.output) as {
    args: string[]
    stdinLength: number
    stdinFirst: string
    stdinLast: string
    systemPrompt: string | null
    cwd: string
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('commandToArgv', () => {
  test('splits a resolved template into an argv array', () => {
    expect(commandToArgv('codex exec --model gpt-5.3')).toEqual(['codex', 'exec', '--model', 'gpt-5.3'])
  })

  test('rejects residual template tokens loudly', () => {
    expect(() => commandToArgv('mytool --step {{step.unknown}} {{evil.token}}')).toThrow(TemplateTokenError)
    try {
      commandToArgv('mytool {{evil.token}}')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateTokenError)
      expect((err as TemplateTokenError).tokens).toEqual(['evil.token'])
      expect((err as Error).message).toContain('evil.token')
    }
  })

  test('rejects an empty command', () => {
    expect(() => commandToArgv('   ')).toThrow()
  })
})

describe('step policy (A-2 AC: readOnly refuses write-mode invocation)', () => {
  const WRITE_MODES = ['develop', 'draft']
  const READ_ONLY_MODES = ['analyze', 'verify', 'review', 'human', 'custom', 'some-custom-mode', '']
  const WRITE_CAPABLE_PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk']

  test('only develop/draft carry a write policy; everything else is readOnly', () => {
    for (const mode of WRITE_MODES) expect(stepPolicyForMode(mode)).toBe('write')
    for (const mode of READ_ONLY_MODES) expect(stepPolicyForMode(mode)).toBe('readOnly')
  })

  test('write modes get acceptEdits, everything else gets plan', () => {
    expect(mapStepModeToPermissionMode('develop')).toBe('acceptEdits')
    expect(mapStepModeToPermissionMode('draft')).toBe('acceptEdits')
    expect(mapStepModeToPermissionMode('analyze')).toBe('plan')
    expect(mapStepModeToPermissionMode('verify')).toBe('plan')
    expect(mapStepModeToPermissionMode('review')).toBe('plan')
    expect(mapStepModeToPermissionMode('some-custom-mode')).toBe('plan')
  })

  test('a readOnly policy NEVER maps to a write-capable permission mode', () => {
    for (const mode of READ_ONLY_MODES) {
      expect(WRITE_CAPABLE_PERMISSION_MODES).not.toContain(mapStepModeToPermissionMode(mode))
    }
  })

  test('the claude spawn spec never carries a write-capable --permission-mode for a readOnly step', () => {
    for (const mode of READ_ONLY_MODES) {
      const spec = buildClaudeSpawnSpec(payload({ mode }), { binArgv: ['claude'] })
      try {
        expect(argAfter(spec, '--permission-mode')).toBe('plan')
      } finally {
        spec.cleanup()
      }
    }
  })

  test('the template runner exposes the policy to custom CLIs via CONDUCTOR_STEP_POLICY', () => {
    const session = {
      policy: 'ephemeral',
      backend: 'process',
      sessionKey: 'k',
      command: FAKE_BIN.join(' '),
      commandError: null,
      maxOutputPreviewChars: 5000,
    }
    expect(buildTemplateSpawnSpec(payload({ session })).env?.CONDUCTOR_STEP_POLICY).toBe('write')
    expect(buildTemplateSpawnSpec(payload({ session, mode: 'verify' })).env?.CONDUCTOR_STEP_POLICY).toBe('readOnly')
  })
})

describe('composeSystemPrompt / composeInstructions', () => {
  test('system prompt merges agent prompt with the mode instructions for the step mode', () => {
    const text = composeSystemPrompt(payload())
    expect(text).toContain('You are Builder')
    expect(text).toContain('Write production-grade code.')
  })

  test('instructions carry task title, description, and step instructions', () => {
    const text = composeInstructions(payload())
    expect(text).toContain('Build calendar')
    expect(text).toContain('A month grid.')
    expect(text).toContain('Implement the calendar view.')
  })

  test('instructions include previousOutput and the rejection feedback when present (v2)', () => {
    const text = composeInstructions(payload({
      previousOutput: 'output from step 1',
      rejectionNote: 'Fix the off-by-one.',
      attempt: 2,
    }))
    expect(text).toContain('Previous Step Output:\noutput from step 1')
    expect(text).toContain('HUMAN FEEDBACK (from previous attempt #1):')
    expect(text).toContain('Fix the off-by-one.')
    expect(text).toContain('Please address this feedback')
  })

  test('no rejection block when there is no note', () => {
    expect(composeInstructions(payload())).not.toContain('HUMAN FEEDBACK')
  })
})

describe('resolveRunnerKind', () => {
  test('claude only when explicitly configured; template when a command exists; echo otherwise', () => {
    expect(resolveRunnerKind('claude', false)).toBe('claude')
    expect(resolveRunnerKind('claude', true)).toBe('claude')
    expect(resolveRunnerKind(undefined, true)).toBe('template')
    expect(resolveRunnerKind('', true)).toBe('template')
    expect(resolveRunnerKind(undefined, false)).toBe('echo')
    expect(resolveRunnerKind('echo', true)).toBe('echo')
  })

  test('an unknown runner value fails loudly at startup', () => {
    expect(() => resolveRunnerKind('yolo', false)).toThrow(/DAEMON_RUNNER/)
  })
})

describe('parseClaudeResultLine', () => {
  test('picks the last result line and tolerates junk lines', () => {
    const stdout = [
      'not json at all',
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'result', is_error: true, result: 'first' }),
      JSON.stringify({ type: 'result', is_error: false, result: 'final', total_cost_usd: 0.5 }),
    ].join('\n')
    const line = parseClaudeResultLine(stdout)
    expect(line).not.toBeNull()
    expect(line?.isError).toBe(false)
    expect(line?.result).toBe('final')
    expect(line?.totalCostUsd).toBe(0.5)
  })

  test('returns null when no result line exists', () => {
    expect(parseClaudeResultLine('{"type":"system"}\nplain text')).toBeNull()
  })
})

describe('validateExecutionPayload', () => {
  test('accepts a complete payload', () => {
    expect(validateExecutionPayload(payload())).toEqual([])
  })

  test('flags missing fields and wrong version', () => {
    const problems = validateExecutionPayload({ payloadVersion: 1, id: 'x' })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('payloadVersion')
  })

  test('accepts an absent/null/string previousOutput, rejects a non-string', () => {
    expect(validateExecutionPayload(payload({ previousOutput: undefined }))).toEqual([])
    expect(validateExecutionPayload(payload({ previousOutput: null }))).toEqual([])
    expect(validateExecutionPayload(payload({ previousOutput: 'prior output' }))).toEqual([])
    expect(validateExecutionPayload(payload({ previousOutput: 42 as unknown as string })).join(' '))
      .toContain('previousOutput')
  })

  test('accepts an absent/null/string rejectionNote, rejects a non-string (G1-2)', () => {
    expect(validateExecutionPayload(payload({ rejectionNote: undefined }))).toEqual([])
    expect(validateExecutionPayload(payload({ rejectionNote: null }))).toEqual([])
    expect(validateExecutionPayload(payload({ rejectionNote: 'address this' }))).toEqual([])
    expect(validateExecutionPayload(payload({ rejectionNote: 7 as unknown as string })).join(' '))
      .toContain('rejectionNote')
  })
})

// ---------------------------------------------------------------------------
// Claude spawn spec (spike A-0 invocation contract)
// ---------------------------------------------------------------------------

describe('buildClaudeSpawnSpec', () => {
  test('follows the spike invocation contract', () => {
    const spec = buildClaudeSpawnSpec(payload(), { binArgv: ['claude'] })
    try {
      expect(spec.argv[0]).toBe('claude')
      expect(spec.argv).toContain('-p')
      expect(argAfter(spec, '--output-format')).toBe('stream-json')
      expect(spec.argv).toContain('--verbose')
      expect(spec.argv).toContain('--no-session-persistence')
      expect(argAfter(spec, '--model')).toBe('claude-sonnet-4-5')
      expect(argAfter(spec, '--permission-mode')).toBe('acceptEdits')
      expect(Number(argAfter(spec, '--max-turns'))).toBeGreaterThan(0)
      // Instructions ride stdin — never argv.
      expect(spec.stdin).toBe(composeInstructions(payload()))
      expect(spec.argv.join(' ')).not.toContain('Implement the calendar view.')
    } finally {
      spec.cleanup()
    }
  })

  test('omits --model when the agent has no runtimeModel', () => {
    const spec = buildClaudeSpawnSpec(
      payload({ agent: { id: 'a', name: 'A', systemPrompt: 'sp', modeInstructions: null, runtimeModel: null } }),
      { binArgv: ['claude'] },
    )
    try {
      expect(spec.argv).not.toContain('--model')
    } finally {
      spec.cleanup()
    }
  })

  test('writes the system prompt to a temp file and cleanup removes it', () => {
    const spec = buildClaudeSpawnSpec(payload(), { binArgv: ['claude'] })
    const file = argAfter(spec, '--append-system-prompt-file')
    expect(file).toBeDefined()
    expect(existsSync(file!)).toBe(true)
    expect(readFileSync(file!, 'utf8')).toBe(composeSystemPrompt(payload()))
    spec.cleanup()
    expect(existsSync(file!)).toBe(false)
  })

  test('arg mode inlines a small system prompt via --append-system-prompt', () => {
    const spec = buildClaudeSpawnSpec(payload(), { binArgv: ['claude'], systemPromptMode: 'arg' })
    try {
      expect(spec.argv).not.toContain('--append-system-prompt-file')
      expect(argAfter(spec, '--append-system-prompt')).toBe(composeSystemPrompt(payload()))
    } finally {
      spec.cleanup()
    }
  })

  test('arg mode still uses the temp file for system prompts >= 8KB', () => {
    const big = payload({
      agent: { id: 'a', name: 'A', systemPrompt: 'x'.repeat(9000), modeInstructions: null, runtimeModel: null },
    })
    const spec = buildClaudeSpawnSpec(big, { binArgv: ['claude'], systemPromptMode: 'arg' })
    try {
      expect(spec.argv).toContain('--append-system-prompt-file')
      expect(spec.argv).not.toContain('--append-system-prompt')
    } finally {
      spec.cleanup()
    }
  })

  test('no system prompt flags when the agent has none', () => {
    const spec = buildClaudeSpawnSpec(payload({ agent: null }), { binArgv: ['claude'] })
    try {
      expect(spec.argv).not.toContain('--append-system-prompt-file')
      expect(spec.argv).not.toContain('--append-system-prompt')
    } finally {
      spec.cleanup()
    }
  })

  test('the command summary never leaks the system prompt', () => {
    const spec = buildClaudeSpawnSpec(payload(), { binArgv: ['claude'], systemPromptMode: 'arg' })
    try {
      expect(spec.summary).not.toContain('You are Builder')
    } finally {
      spec.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// End-to-end against the fake CLI (no shell, no spend)
// ---------------------------------------------------------------------------

describe('claude runner against the fake CLI', () => {
  test('a multi-KB prompt reaches the CLI stdin intact', async () => {
    const filler = Array.from({ length: 300 }, (_, i) => `filler line ${i} ${'x'.repeat(50)}`).join('\n')
    const instructions = `START-TOKEN\n${filler}\nEND-TOKEN`
    const p = payload({ instructions })
    const { outcome } = await runClaude(p)
    expect(outcome.ok).toBe(true)
    const report = fakeReport(outcome)
    expect(report.stdinLength).toBe(Buffer.byteLength(composeInstructions(p), 'utf8'))
    expect(report.stdinLength).toBeGreaterThan(10_000)
    expect(report.stdinFirst).toContain('Task:')
    expect(report.stdinLast).toContain('END-TOKEN')
  })

  test('the system prompt file is delivered and cleaned up after the run', async () => {
    const p = payload()
    const spec = buildClaudeSpawnSpec(p, { binArgv: FAKE_BIN })
    const file = argAfter(spec, '--append-system-prompt-file')!
    expect(existsSync(file)).toBe(true)
    const proc = await runSpawnSpec(spec, { timeoutMs: 20_000, cwd: TEST_WORKSPACE })
    const outcome = interpretResult('claude', proc)
    expect(outcome.ok).toBe(true)
    expect(fakeReport(outcome).systemPrompt).toBe(composeSystemPrompt(p))
    expect(existsSync(file)).toBe(false)
  })

  test('exit 0 with is_error=true is still a failure (spike finding #8)', async () => {
    const { outcome } = await runClaude(payload(), { env: { FAKE_IS_ERROR: '1' } })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('is_error')
  })

  test('a missing result line is a failure', async () => {
    const { outcome } = await runClaude(payload(), { env: { FAKE_NO_RESULT: '1' } })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('result')
  })

  test('non-zero exit is a failure carrying the stderr tail', async () => {
    const { outcome } = await runClaude(payload(), {
      env: { FAKE_EXIT: '3', FAKE_STDERR: 'boom: credentials rejected' },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.exitCode).toBe(3)
    expect(outcome.error).toContain('credentials rejected')
  })

  test('success carries the result text and cost metadata', async () => {
    const { outcome } = await runClaude(payload())
    expect(outcome.ok).toBe(true)
    expect(outcome.claude?.totalCostUsd).toBe(0.0123)
    expect(outcome.claude?.sessionId).toBe('fake-session')
    expect(outcome.claude?.numTurns).toBe(1)
  })

  test('the child spawns in the mapped workspace cwd, not the daemon cwd (A-2 SECURITY)', async () => {
    const { outcome } = await runClaude(payload(), { cwd: TEST_WORKSPACE })
    expect(outcome.ok).toBe(true)
    const report = fakeReport(outcome)
    // Case-insensitive compare — Windows may report a different path casing.
    expect(report.cwd.toLowerCase()).toBe(TEST_WORKSPACE.toLowerCase())
    expect(report.cwd.toLowerCase()).not.toBe(process.cwd().toLowerCase())
  })

  test('runSpawnSpec refuses to run without an absolute cwd — no process.cwd() fallback', async () => {
    for (const cwd of [undefined, '', 'relative/workspace']) {
      const spec = buildClaudeSpawnSpec(payload(), { binArgv: FAKE_BIN })
      // @ts-expect-error — cwd is required; the runtime guard must also hold
      const attempt = runSpawnSpec(spec, { timeoutMs: 20_000, cwd })
      await expect(attempt).rejects.toThrow(/absolute cwd/)
      // temp system-prompt files must still be cleaned up on refusal
      const file = argAfter(spec, '--append-system-prompt-file')
      expect(existsSync(file!)).toBe(false)
    }
  })

  test('the daemon-side timeout kills the child and yields exit 124', async () => {
    const { outcome } = await runClaude(payload(), {
      env: { FAKE_SLEEP_MS: '30000' },
      timeoutMs: 750,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.exitCode).toBe(124)
    expect(outcome.error).toContain('124')
  }, 15_000)
})

describe('template (generic) runner', () => {
  test('renders the resolved command to argv and pipes the whole composed prompt to stdin', async () => {
    const p = payload({
      session: {
        policy: 'ephemeral',
        backend: 'process',
        sessionKey: 'step-step-1',
        command: FAKE_BIN.join(' '),
        commandError: null,
        maxOutputPreviewChars: 5000,
      },
    })
    const spec = buildTemplateSpawnSpec(p)
    expect(spec.argv).toEqual(FAKE_BIN)
    const proc = await runSpawnSpec(spec, { timeoutMs: 20_000, cwd: TEST_WORKSPACE })
    const outcome = interpretResult('template', proc)
    expect(outcome.ok).toBe(true)
    // Generic CLIs have no system-prompt channel: it rides stdin too.
    const expected = [composeSystemPrompt(p), composeInstructions(p)].join('\n\n')
    const lastResult = parseClaudeResultLine(proc.stdout)
    const report = JSON.parse(lastResult!.result!) as { stdinLength: number }
    expect(report.stdinLength).toBe(Buffer.byteLength(expected, 'utf8'))
    // Template runner treats output as plain text (full stdout passthrough).
    expect(outcome.output).toBe(proc.stdout)
  })

  test('a command with residual tokens fails loudly instead of spawning', () => {
    const p = payload({
      session: {
        policy: 'ephemeral',
        backend: 'process',
        sessionKey: 'k',
        command: 'mytool {{not.a.token}}',
        commandError: null,
        maxOutputPreviewChars: 5000,
      },
    })
    expect(() => buildTemplateSpawnSpec(p)).toThrow(TemplateTokenError)
  })
})

describe('echo runner (safety default)', () => {
  test('spawns without any shell and mentions the step', async () => {
    const spec = buildEchoSpawnSpec(payload())
    expect(spec.argv[0]).not.toMatch(/cmd(\.exe)?$|^sh$/)
    const proc = await runSpawnSpec(spec, { timeoutMs: 20_000, cwd: TEST_WORKSPACE })
    const outcome = interpretResult('echo', proc)
    expect(outcome.ok).toBe(true)
    expect(outcome.output).toContain('step-1')
    expect(outcome.output).toContain('echo runner')
  })
})
