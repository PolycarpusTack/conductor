/**
 * daemon-e2e fixture CLI (story A-4) — a spend-free stand-in for a real
 * agent CLI, invoked by the reference daemon's generic template runner
 * (`commandTemplate: "bun <this file>"`).
 *
 * Contract it proves, end to end, with zero LLM spend:
 *   - the composed prompt (system prompt + task context + step instructions)
 *     arrives on stdin (SPIKE A-0 stdin protocol)
 *   - the process runs with cwd = the daemon's workspace directory (A-2):
 *     it writes `smoke-output.md` into cwd, so the file landing in the temp
 *     workspace proves both cwd enforcement and prompt delivery
 *   - stdout is streamed as session events and reported as step output (A-3)
 *   - exit 0 completes the step
 *
 * A `DAEMON-E2E-SLEEP-<ms>` marker in the prompt makes it sleep before
 * writing — used by the lease-reclaim scenario, where the daemon is killed
 * while this fixture is still running.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const prompt = await readStdin()

const sleepMatch = prompt.match(/DAEMON-E2E-SLEEP-(\d+)/)
if (sleepMatch) {
  await new Promise((resolve) => setTimeout(resolve, Number(sleepMatch[1])))
}

// cwd is the daemon-resolved workspace directory — writing here is the proof.
writeFileSync(
  join(process.cwd(), 'smoke-output.md'),
  `# daemon e2e smoke output\n\nFirst 200 chars of the prompt this CLI received on stdin:\n\n${prompt.slice(0, 200)}\n`,
  'utf8',
)

console.log(
  `SMOKE-FIXTURE-OK wrote smoke-output.md (prompt ${prompt.length} chars, ` +
    `policy=${process.env.CONDUCTOR_STEP_POLICY ?? 'unset'}, cwd=${process.cwd()})`,
)
