import { test, expect } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers'

/**
 * first-run: an unauthenticated visitor lands on the marketing page, launches
 * the board, is met by the auth gate, signs in with the admin password, and
 * sees the board chrome render. Covers the landing → auth → board journey.
 *
 * No API pre-login here — this spec exercises the real sign-in UI.
 */
test('landing → launch board → sign in → board chrome renders', async ({ page }) => {
  // 1. Land on the marketing page.
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Launch Board' }).first()).toBeVisible()

  // 2. Navigate to the board — the auth gate lives in the (board) layout.
  await page.getByRole('button', { name: 'Launch Board' }).first().click()
  await expect(page).toHaveURL(/\/board/)

  // 3. Auth gate. The email field is only shown once an owner account exists
  //    (usersExist); fill it adaptively so the spec works on both a fresh DB
  //    (password-only bootstrap) and a seeded one.
  await expect(page.getByRole('heading', { name: 'Admin Access' })).toBeVisible()

  const emailInput = page.getByPlaceholder('you@example.com')
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(ADMIN_EMAIL)
  }
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign In' }).click()

  // 4. Board chrome renders: the auth gate is gone and the persistent header
  //    (brand + navigation) is present. This holds whether the board shows a
  //    seeded project, the empty "No projects yet" state, or the demo path.
  await expect(page.getByRole('heading', { name: 'Admin Access' })).toBeHidden()
  await expect(page.getByText('Conductor').first()).toBeVisible()

  // The board canvas is present: either real columns, the empty-board state,
  // or a load-demo affordance — any of these proves the chrome mounted.
  await expect(
    page
      .getByText('Backlog')
      .first()
      .or(page.getByRole('heading', { name: 'No projects yet' }))
      .or(page.getByText('Load Demo Data')),
  ).toBeVisible()
})
