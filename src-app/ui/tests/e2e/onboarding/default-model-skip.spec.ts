import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import {
  loginAsAdmin,
  getAdminToken,
  getCurrentUserToken,
  createTestUser,
  loginExpectingOnboarding,
} from '../../common/auth-helpers'

/**
 * Onboarding "Local Model" step — the SKIP path.
 *
 * Covers TEST-16 (acceptance, INV-3) of the `default-model-onboarding` feature.
 *
 * > **INV-3**: Onboarding is **completable without installing the model**. The
 * > download is offerable, never mandatory; skipping leaves a valid state.
 *
 * The design's own note is that "a 5.68 GB download inside a wizard is the main
 * UX risk. It must not block completion." This is the spec that would fail if it
 * ever did — and it checks the "leaves a valid state" clause too, by asserting
 * nothing was started and nothing installed.
 */
test.describe('Onboarding — Local Model step is skippable', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  test('an admin finishes Onboarding without installing, and nothing was started', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const username = `dm_skip_${Date.now().toString(36)}`
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@ex.com`,
      'password123',
      // The full set the install flow needs — so this spec proves the offer was
      // genuinely available and DECLINED, not merely unavailable.
      [
        'profile::read',
        'profile::edit',
        'llm_models::create',
        'llm_models::read',
        'llm_providers::read',
        'llm_providers::edit',
        'llm_providers::assign_groups',
        'llm_repositories::read',
        'llm_local_runtime::versions_read',
        'llm_local_runtime::create',
        'llm_local_runtime::update',
        'groups::read',
      ],
    )

    await loginExpectingOnboarding(page, baseURL, username, 'password123')

    await expect(byTestId(page, 'onboarding-step-welcome')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-api-keys')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()

    // The step is reached, the offer IS there — and Next is enabled without
    // having touched it. That is the invariant: offerable, never mandatory.
    await expect(byTestId(page, 'onboarding-step-default-model')).toBeVisible()
    await expect(byTestId(page, 'onboarding-default-model-install-button')).toBeVisible()
    await expect(byTestId(page, 'onboarding-page-next-button')).toBeEnabled()
    await byTestId(page, 'onboarding-page-next-button').click()

    // …and the rest of the wizard completes normally into the app.
    await expect(byTestId(page, 'onboarding-step-mcp-servers')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-memory-setup')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(byTestId(page, 'onboarding-step-finish')).toBeVisible()
    await byTestId(page, 'onboarding-page-next-button').click()
    await expect(page).toHaveURL(new RegExp('/chat'), { timeout: 15000 })

    // "Leaves a valid state": skipping started no transfer and installed no
    // model. A step that quietly kicked off a 5.68 GB download on the way past
    // would still have satisfied every assertion above.
    const userToken = await getCurrentUserToken(page)
    const headers = { Authorization: `Bearer ${userToken}` }

    const downloads = await page.request.get(`${apiURL}/api/llm-models/downloads`, {
      headers,
    })
    expect(downloads.status()).toBe(200)
    expect(
      (await downloads.json()).downloads,
      'skipping must not have started a download',
    ).toEqual([])

    const models = await page.request.get(
      `${apiURL}/api/llm-models?page=1&perPage=100`,
      { headers },
    )
    expect(models.status()).toBe(200)
    const installed = (await models.json()).models as { name: string }[]
    expect(
      installed.some(m => m.name === 'ziee-default-qwen3-5-9b-q4-k-m'),
      'skipping must not have installed the default model',
    ).toBe(false)
  })
})
