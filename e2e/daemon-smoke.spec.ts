import { spawnSync } from 'node:child_process'

import { test, expect } from '@playwright/test'

/**
 * daemon-smoke (light): the real daemon end-to-end path is already covered by
 * the A-4 API-level smoke — `bun run smoke:daemon` (scripts/doctor.ts
 * --daemon-e2e), which spawns a real daemon + CLI and drives a step to
 * completion. Re-implementing that in a browser would need a live LLM runtime,
 * which is out of scope for a UI e2e pack.
 *
 * So this spec is a thin, opt-in wrapper: by default it is SKIPPED with a
 * pointer to the existing smoke. Set E2E_DAEMON_SMOKE=1 to actually shell out
 * to `bun run smoke:daemon` and assert a clean exit — useful in a CI job that
 * has the CLI/runtime configured.
 */
test('daemon end-to-end smoke (bun run smoke:daemon)', async () => {
  test.skip(
    process.env.E2E_DAEMON_SMOKE !== '1',
    'Daemon e2e is covered by `bun run smoke:daemon` (A-4 doctor --daemon-e2e). ' +
      'Set E2E_DAEMON_SMOKE=1 to run it here.',
  )

  // Long: spawns a daemon + CLI and executes a real step.
  test.setTimeout(300_000)

  const result = spawnSync('bun', ['run', 'smoke:daemon'], {
    stdio: 'inherit',
    shell: true,
  })

  expect(result.error, `failed to launch smoke:daemon: ${result.error?.message}`).toBeUndefined()
  expect(result.status, 'smoke:daemon should exit 0').toBe(0)
})
