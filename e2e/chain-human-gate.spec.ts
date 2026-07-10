import { test, expect } from '@playwright/test'

import {
  apiLogin,
  createProject,
  createTask,
  deleteProject,
  getTaskSteps,
} from './helpers'

/**
 * chain-human-gate: a chain that starts ON a human-review step parks the task
 * in WAITING with the human step active; approving the gate through the task
 * drawer advances the chain to completion.
 *
 * Scope note: the chain is a single human step, deliberately. Driving a full
 * agent→human chain would require a live dispatcher + LLM runtime, which is out
 * of scope for a UI smoke pack. This covers the human-gate state-machine
 * surface (WAITING park → approve → advance/DONE) that needs no real dispatch.
 * The dispatcher itself is covered by the bun unit suite + the A-4 daemon smoke.
 */
let projectId: string | undefined

test.afterEach(async ({ request }) => {
  await deleteProject(request, projectId)
  projectId = undefined
})

test('human-gate chain parks in WAITING → approve in drawer → advances', async ({ page }) => {
  await apiLogin(page.request)
  const project = await createProject(page.request, `E2E Gate ${Date.now()}`)
  projectId = project.id
  const title = `Human Gate ${Date.now()}`
  const task = await createTask(page.request, {
    title,
    projectId: project.id,
    steps: [{ mode: 'human', humanLabel: 'Review me', autoContinue: false }],
  })

  // Precondition (server state): the chain started, the human step is active,
  // and the task is parked in WAITING awaiting a human.
  const steps = await getTaskSteps(page.request, task.id)
  expect(steps).toHaveLength(1)
  expect(steps[0]?.mode).toBe('human')
  expect(steps[0]?.status).toBe('active')

  await page.goto('/board')

  // Task renders parked in WAITING.
  const card = page.getByText(title, { exact: true })
  await expect(card).toBeVisible()
  await card.click()

  const drawer = page.locator('div.animate-slide-in')
  await expect(drawer.getByRole('heading', { name: title })).toBeVisible()
  await expect(drawer.getByText('WAITING')).toBeVisible()

  // Approve the gate via the drawer's human-step controls. The Approve button
  // only appears once the active human step's details have loaded.
  const approve = drawer.getByRole('button', { name: 'Approve' })
  await expect(approve).toBeVisible()
  await approve.click()

  // The chain advances. As the only step, approval completes the task → DONE.
  // The drawer refreshes its task in place, so the header badge flips to DONE.
  await expect(drawer.getByText('DONE')).toBeVisible()
  await expect(drawer.getByText('WAITING')).toBeHidden()

  // Confirm at the server layer too: the step is no longer awaiting a human.
  const afterSteps = await getTaskSteps(page.request, task.id)
  expect(afterSteps[0]?.status).not.toBe('active')
})
