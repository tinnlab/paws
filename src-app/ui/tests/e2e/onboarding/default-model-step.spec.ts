import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  loginExpectingOnboarding,
} from '../../common/auth-helpers'

/**
 * Onboarding "Local Model" step — the browser-side proofs.
 *
 * Covers TEST-15 (acceptance, INV-2), TEST-17 (restricted user) and TEST-18
 * (390px) of the `default-model-onboarding` feature.
 *
 * These specs deliberately do NOT click Install. Completing the real install
 * would need either a live Hugging Face fetch (forbidden by the design's test
 * strategy — "do not hit the real HF in tests") or an edit to the shared
 * per-test server spawn to point it at a fixture (forbidden by rule B3). The
 * install legs are proven for real at the integration tier instead
 * (`server/tests/llm_model/default_model_{download,install}_test.rs`), and the
 * step's transfer/failure/installed renders at the component tier
 * (`DefaultModelStep.test.tsx`). What only a browser can prove is what is
 * asserted here: that the step is genuinely inside the wizard, in the right
 * place, offering the right thing, to the right people, at the right size.
 */

const ONBOARDING_USER_PERMS = [
  'profile::read',
  'profile::edit',
  'llm_models::create',
  'llm_models::read',
  'llm_providers::read',
  'llm_providers::edit',
  'llm_repositories::read',
  'llm_local_runtime::versions_read',
  'llm_local_runtime::create',
]

test.describe('Onboarding — Local Model step', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  /**
   * TEST-15 (acceptance, INV-2) — "The user reaches a working model WITHOUT
   * LEAVING ONBOARDING and without visiting a settings page."
   *
   * The "working model" half is TEST-6 (integration). This is the location
   * half, and it is the half a browser is uniquely able to check: the offer has
   * to be reachable from inside the wizard, immediately after AI Providers, with
   * no navigation away from `/onboarding` at any point.
   */
  test('the step sits inside the wizard right after AI Providers, offering the default model', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const username = `dm_offer_${Date.now().toString(36)}`
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@ex.com`,
      'password123',
      ONBOARDING_USER_PERMS,
    )

    // Record every URL the wizard visits, so "without visiting a settings page"
    // is asserted rather than assumed.
    const visited: string[] = []
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) visited.push(frame.url())
    })

    await loginExpectingOnboarding(page, baseURL, username, 'password123')

    await expect(byTestId(page, 'onboarding-step-welcome')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()

    // AI Providers is the step before — that adjacency is the design's
    // "a user who added a key can skip".
    await expect(byTestId(page, 'onboarding-step-api-keys')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()

    const step = byTestId(page, 'onboarding-step-default-model')
    await expect(step).toBeVisible()

    // The offer names what is actually being installed: the quant file and its
    // size. A first-run user consenting to a multi-GB download is entitled to
    // both numbers before they click.
    await expect(step).toContainText('Qwen3.5-9B-Q4_K_M.gguf')
    await expect(step).toContainText('5.68 GB')
    await expect(byTestId(page, 'onboarding-default-model-install-button')).toBeVisible()
    await expect(byTestId(page, 'onboarding-default-model-install-button')).toBeEnabled()

    // Still inside the wizard, and no settings route was ever loaded.
    await expect(page).toHaveURL(/\/onboarding/)
    expect(
      visited.filter(u => u.includes('/settings')),
      `the offer must be reachable without a settings page; visited ${visited.join(', ')}`,
    ).toHaveLength(0)
  })

  /**
   * TEST-17 — a user LACKING the model-create permission.
   *
   * The positive control is the half that makes this mean anything: assert the
   * step really RENDERS for them and that they can move past it. Without it,
   * "no Install button" passes identically when the page failed to load, the
   * route bounced, or the component crashed — and the spec would stay green with
   * the permission check deleted.
   */
  test('a user without the model-create permission sees an explanation, not controls', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const username = `dm_norights_${Date.now().toString(36)}`
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@ex.com`,
      'password123',
      ['profile::read', 'profile::edit'],
    )

    await loginExpectingOnboarding(page, baseURL, username, 'password123')

    await expect(byTestId(page, 'onboarding-step-welcome')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-api-keys')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()

    // POSITIVE CONTROL — the step renders for this user.
    const step = byTestId(page, 'onboarding-step-default-model')
    await expect(step).toBeVisible()
    await expect(step).toContainText('Local Model')
    await expect(step).toContainText('administrator')

    // …and every install affordance is absent.
    await expect(byTestId(page, 'onboarding-default-model-install-button')).toHaveCount(0)
    await expect(byTestId(page, 'onboarding-default-model-cancel-button')).toHaveCount(0)
    await expect(byTestId(page, 'onboarding-default-model-retry-button')).toHaveCount(0)

    // POSITIVE CONTROL (2) — the wizard is still navigable for them, so the
    // absent controls are a gate rather than a broken page.
    await expect(byTestId(page, 'onboarding-page-next-button')).toBeEnabled()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-mcp-servers')).toBeVisible()
  })

  /**
   * TEST-18 — the step at a phone-sized viewport.
   *
   * A surface that only works at desktop width is a defect; the wizard is the
   * very first thing a user sees, so it is the worst place to ship one. The
   * axe / AA-contrast pass over the same surface is `gate:ui`'s job — this
   * covers the layout half that a headless component test cannot see.
   */
  test('the step has no horizontal overflow at 390px and keeps its controls', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const username = `dm_narrow_${Date.now().toString(36)}`
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@ex.com`,
      'password123',
      ONBOARDING_USER_PERMS,
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await loginExpectingOnboarding(page, baseURL, username, 'password123')

    await expect(byTestId(page, 'onboarding-step-welcome')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-api-keys')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()

    await expect(byTestId(page, 'onboarding-step-default-model')).toBeVisible()

    const install = byTestId(page, 'onboarding-default-model-install-button')
    await expect(install).toBeVisible()

    // The control must be inside the viewport, not merely present in the DOM.
    const box = await install.boundingBox()
    expect(box, 'the install control has a layout box').not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)

    // …and the page itself does not scroll sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(1)
  })
})
