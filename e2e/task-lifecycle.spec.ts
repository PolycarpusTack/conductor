import { test, expect } from '@playwright/test'

import { apiLogin, createProject, createTask, deleteProject } from './helpers'

/**
 * task-lifecycle: authenticated operator moves a task across columns via the
 * UI. Setup is seeded through the API (a fresh project + one BACKLOG task) so
 * the test starts from a known board; the newest project is auto-selected by
 * the board on load, so no project switching is needed.
 *
 * The move is driven through the task edit dialog rather than pointer drag —
 * dnd-kit pointer dragging is flaky under automation and the drag→status
 * mapping is already covered by unit tests (useTaskManager). The dialog path
 * exercises the same status-change → column-placement UI surface end to end.
 */
let projectId: string | undefined

test.afterEach(async ({ request }) => {
  await deleteProject(request, projectId)
  projectId = undefined
})

test('create task (API) → drawer → edit status → lands in target column', async ({ page }) => {
  // Seed through the page's request context so the session cookie is shared
  // with the browser and the board loads already authenticated.
  await apiLogin(page.request)
  const project = await createProject(page.request, `E2E Lifecycle ${Date.now()}`)
  projectId = project.id
  const title = `Lifecycle Task ${Date.now()}`
  await createTask(page.request, { title, projectId: project.id, status: 'BACKLOG' })

  await page.goto('/board')

  // The seeded task renders on the board (newest project auto-selected).
  const card = page.getByText(title, { exact: true })
  await expect(card).toBeVisible()

  // Open the task drawer.
  await card.click()
  const drawer = page.locator('div.animate-slide-in')
  await expect(drawer.getByRole('heading', { name: title })).toBeVisible()
  // Backlog is the starting column.
  await expect(drawer.getByText('BACKLOG')).toBeVisible()

  // Edit → the drawer's pencil button (icon-only; scoped to the drawer).
  await drawer.locator('button:has(svg.lucide-pencil)').first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit Task' })).toBeVisible()

  // Change Status: BACKLOG → In Progress. Scope the combobox to the Status
  // field so we don't hit the Priority/Tag/Agent selects.
  const statusField = dialog.locator('div.grid.gap-2', {
    has: page.getByText('Status', { exact: true }),
  })
  await statusField.getByRole('combobox').click()
  await page.getByRole('option', { name: 'In Progress' }).click()

  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog).toBeHidden()

  // Verify it landed in the In Progress column. Re-open the drawer: the status
  // badge is the authoritative signal (column membership is a pure function of
  // status), and we also assert the card sits under the In Progress column.
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  await page.getByText(title, { exact: true }).click()
  await expect(drawer.getByText('IN PROGRESS')).toBeVisible()
  await expect(drawer.getByText('BACKLOG')).toBeHidden()

  // Column-level assertion: the card lives in the column whose header reads
  // "In Progress". statusColumns renders one column div per status.
  const inProgressColumn = page
    .locator('div')
    .filter({ has: page.getByText('In Progress', { exact: true }) })
    .filter({ has: page.getByText(title, { exact: true }) })
  await expect(inProgressColumn.first()).toBeVisible()
})
