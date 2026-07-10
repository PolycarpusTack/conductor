import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Shared helpers for the G-1 e2e specs. Data is seeded through the same HTTP
 * API the UI uses (via Playwright's request context), then the UI is driven —
 * this avoids brittle multi-dialog setup and keeps each spec independent.
 */

export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.AGENTBOARD_ADMIN_PASSWORD ?? 'admin123'

// The owner account the app bootstraps from the legacy password on first login
// (see AuthView: "Your account is owner@conductor.local"). Overridable for CI.
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'owner@conductor.local'

/**
 * Authenticate the given request context's cookie jar. `page.request` shares
 * cookies with its BrowserContext, so calling this with `page.request` before
 * `page.goto` means the page loads already-signed-in.
 *
 * Adaptive: a fresh DB has no users, so password-only login is accepted and
 * bootstraps the owner. Once an owner exists the API requires email+password.
 */
export async function apiLogin(request: APIRequestContext): Promise<void> {
  const sessionRes = await request.get('/api/admin/session')
  expect(sessionRes.ok(), `session probe failed: ${sessionRes.status()}`).toBeTruthy()
  const session = (await sessionRes.json()) as { usersExist?: boolean; configured?: boolean }

  const body = session.usersExist
    ? { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    : { password: ADMIN_PASSWORD }

  const res = await request.post('/api/admin/session', { data: body })
  expect(
    res.ok(),
    `admin login failed (${res.status()}): ${await res.text()}`,
  ).toBeTruthy()
}

export interface CreatedProject {
  id: string
  name: string
  apiKey?: string
}

export async function createProject(
  request: APIRequestContext,
  name: string,
): Promise<CreatedProject> {
  const res = await request.post('/api/projects', { data: { name } })
  expect(res.ok(), `create project failed (${res.status()}): ${await res.text()}`).toBeTruthy()
  return (await res.json()) as CreatedProject
}

export interface StepInput {
  mode: string
  agentId?: string
  humanLabel?: string
  instructions?: string
  autoContinue?: boolean
}

export interface CreatedTask {
  id: string
  title: string
  status: string
}

export async function createTask(
  request: APIRequestContext,
  data: {
    title: string
    projectId: string
    status?: string
    priority?: string
    steps?: StepInput[]
  },
): Promise<CreatedTask> {
  const res = await request.post('/api/tasks', { data })
  expect(res.ok(), `create task failed (${res.status()}): ${await res.text()}`).toBeTruthy()
  return (await res.json()) as CreatedTask
}

/** Best-effort cleanup so the shared dev DB doesn't accumulate test projects. */
export async function deleteProject(
  request: APIRequestContext,
  id: string | undefined,
): Promise<void> {
  if (!id) return
  await request.delete(`/api/projects/${id}`).catch(() => {})
}

/** Fetch a task's live steps (used to assert human-gate state transitions). */
export async function getTaskSteps(
  request: APIRequestContext,
  taskId: string,
): Promise<Array<{ id: string; mode: string; status: string }>> {
  const res = await request.get(`/api/tasks/${taskId}/steps`)
  expect(res.ok(), `get steps failed (${res.status()})`).toBeTruthy()
  return (await res.json()) as Array<{ id: string; mode: string; status: string }>
}
