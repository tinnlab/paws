import { test, expect } from '../../fixtures/test-context'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
} from '../../common/auth-helpers'

/**
 * E2E — a non-admin can LEAVE the onboarding wizard.
 *
 * The companion to `guarded-route-redirect.spec.ts`, which asserts only that
 * the redirect FIRES. That half shipped tested; this half did not, and the
 * gap was a real lockout: the live exploration rig registered an ordinary
 * non-admin account on 2026-08-01, landed on `/onboarding?id=getting-started`,
 * and recorded 262 bounces across 11 escape targets — including the page's own
 * "Back to Chat" button — because `OnboardingRedirect` re-fired on every
 * pathname change and dragged the user back.
 *
 * The wizard could not be completed out of either: `applyMcpServerChanges`
 * throws on any per-item failure (a 403 on the admin-only system-server
 * toggle, or an incompatible hub item) and `handleGlobalNext` then refuses to
 * advance. So "leave" was the only exit, and it did not work.
 */

async function loginAsFreshNonAdmin(
  page: import('@playwright/test').Page,
  baseURL: string,
  username: string,
) {
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`)
  }
  const { access_token } = await res.json()
  // Deliberately do NOT complete onboarding — the redirect must fire first,
  // otherwise this test would pass for the wrong reason.
  await page.addInitScript(token => {
    try {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { token }, version: 0 }),
      )
    } catch {
      /* ignore */
    }
  }, access_token)
}

test.describe('Onboarding — the user can leave', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  test('"Back to Chat" escapes the wizard and is not undone', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const username = `escape_${Date.now().toString(36)}`
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@ex.com`,
      'password123',
      ['profile::read', 'profile::edit'],
    )

    await loginAsFreshNonAdmin(page, baseURL, username)
    await page.goto(`${baseURL}/settings/profile`)

    // Positive control: the gate still works — we really are trapped first.
    await page.waitForURL(/\/onboarding/, { timeout: 15000 })

    // The escape affordance the page renders must actually escape.
    await page
      .getByTestId('onboarding-page-back-to-chat-button')
      .click()

    await page.waitForURL(/\/chat/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/chat/)

    // And it must STAY escaped. This is the assertion that actually fails
    // without the fix: the redirect effect re-evaluates on the next render
    // and used to navigate straight back, so landing on /chat for one frame
    // was never the same as leaving.
    await page.waitForTimeout(2000)
    await expect(page).toHaveURL(/\/chat/)

    // NOTE (deliberate, not an oversight): the dismissal is in-memory, so a
    // FULL page load re-arms the gate and nudges the user back to the wizard
    // once more. That is the intended "remind, don't trap" behaviour — the
    // escape button works again immediately. Only an unconditional,
    // un-escapable redirect is the defect.
  })
})
