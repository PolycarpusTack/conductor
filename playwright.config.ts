import { defineConfig, devices } from '@playwright/test'

/**
 * G-1: Playwright e2e pack for AgentBoard's critical journeys.
 *
 * Runs against `bun run dev` (the Next dev server) — NOT the standalone
 * production build, which does not start on Windows (F-1: Turbopack ':' in
 * filenames). `bun run dev` uses Next's own Node runtime for API routes, so
 * better-sqlite3 (Node-only) works. Verified locally: /api/health → 200.
 *
 * Kept intentionally light: chromium only, single worker (the specs seed
 * shared server state via the API and assert on the newest project, so they
 * must not interleave), retries 1.
 *
 * CI / DB prerequisites:
 *   - A migrated DB must exist before the webServer boots (e.g. `bun run
 *     db:push` against a fresh `file:./prisma/dev.db`). The webServer only
 *     runs `bun run dev`; it does not migrate.
 *   - Admin password + WS secrets are injected via the webServer env block
 *     below (falling back to the repo .env dev values) so the app boots even
 *     when no .env is present.
 */

const PORT = Number(process.env.E2E_PORT ?? 3111)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Serial: specs mutate shared server state (projects/tasks) and rely on the
  // board auto-selecting the newest project. Parallelism would race them.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'bun run dev',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      AGENTBOARD_ADMIN_PASSWORD: process.env.AGENTBOARD_ADMIN_PASSWORD ?? 'admin123',
      AGENTBOARD_WS_SECRET: process.env.AGENTBOARD_WS_SECRET ?? 'ws-secret-change-me',
      AGENTBOARD_WS_INTERNAL_SECRET:
        process.env.AGENTBOARD_WS_INTERNAL_SECRET ?? 'ws-internal-secret-change-me',
      DATABASE_URL: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
    },
  },
})
