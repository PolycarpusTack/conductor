/**
 * Fake CLI for runner tests (SPIKE A-0 contract, without spend).
 *
 * Mimics `claude -p --output-format stream-json`: reads the whole prompt from
 * stdin, honors the system-prompt flags, emits NDJSON lines, and exits with a
 * controllable code. NEVER performs network calls.
 *
 * Env knobs:
 *   FAKE_EXIT      exit code (default 0)
 *   FAKE_IS_ERROR  '1' → final result line carries is_error: true
 *   FAKE_NO_RESULT '1' → omit the final result line entirely
 *   FAKE_STDERR    text emitted on stderr
 *   FAKE_SLEEP_MS  delay before exiting (daemon-timeout tests)
 *
 * The result line's `result` field is a JSON string reporting what the fake
 * actually received (args, stdin byte length and edges, system prompt), so
 * tests can assert delivery integrity end to end.
 */

import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const stdin = await Bun.stdin.text()

// System prompt delivery — mirrors the real CLI's fail-fast on a missing file.
let systemPrompt: string | null = null
const fileIdx = args.indexOf('--append-system-prompt-file')
if (fileIdx !== -1) {
  const path = args[fileIdx + 1]
  if (!path || !existsSync(path)) {
    console.error(`fake-cli: system prompt file missing: ${path}`)
    process.exit(1)
  }
  systemPrompt = readFileSync(path, 'utf8')
}
const argIdx = args.indexOf('--append-system-prompt')
if (argIdx !== -1) systemPrompt = args[argIdx + 1] ?? null

if (process.env.FAKE_STDERR) console.error(process.env.FAKE_STDERR)

// NDJSON stream, shaped like the spike's observed output.
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }))
console.log(
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }),
)

if (process.env.FAKE_NO_RESULT !== '1') {
  const isError = process.env.FAKE_IS_ERROR === '1'
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: isError ? 'error_during_execution' : 'success',
      is_error: isError,
      result: JSON.stringify({
        args,
        stdinLength: Buffer.byteLength(stdin, 'utf8'),
        stdinFirst: stdin.slice(0, 40),
        stdinLast: stdin.slice(-40),
        systemPrompt,
        cwd: process.cwd(),
      }),
      total_cost_usd: 0.0123,
      session_id: 'fake-session',
      num_turns: 1,
    }),
  )
}

const sleepMs = Number(process.env.FAKE_SLEEP_MS || 0)
if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs))

process.exit(Number(process.env.FAKE_EXIT || 0))
