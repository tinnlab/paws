import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'

/**
 * REGRESSION GUARD for the entry-slimming bundle change (ITEM-1 vendor split,
 * ITEM-2 react-icons → lucide + custom brand SVGs). Drives the REAL backend
 * through the UI (no page.route mocks): a bundle change that duplicated React
 * (bad vendor split) would crash the boot, and a broken icon swap would render a
 * blank/missing glyph. The lazy date-picker (ITEM-3) is separately guarded by the
 * existing chat/mcp-elicitation-submit-roundtrip.spec.ts "date field" test, which
 * opens the (now-lazy) DatePicker calendar and binds a date end-to-end.
 */
test.describe('entry-slimming — boot + icon regression guard', () => {
  test('TEST-1: the production app boots and the shell renders with no console/page error (vendor split intact)', async ({
    page,
    testInfra,
  }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', msg => {
      if (msg.type() !== 'error') return
      const t = msg.text()
      // SSE streams cut+reconnect under the vite preview proxy — expected noise.
      if (/ERR_INCOMPLETE_CHUNKED_ENCODING|net::ERR_ABORTED|Failed to load resource/.test(t)) return
      errors.push(`console.error: ${t}`)
    })

    await loginAsAdmin(page, testInfra.baseURL)

    // The app shell rendered (a working boot with a single React instance) — the
    // main landmark is present, and the root ErrorBoundary did NOT trip.
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0)

    expect(errors, `unexpected runtime errors:\n${errors.join('\n')}`).toEqual([])
  })

  test('TEST-2: swapped icons render (lucide glyphs on /settings + the custom OpenAI brand SVG)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)

    // (a) lucide swaps: the settings page renders its Settings/chevron glyphs.
    // lucide-react emits <svg class="lucide ..."> — assert at least one is shown.
    await page.goto(`${baseURL}/settings`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('svg.lucide').first()).toBeVisible({ timeout: 20000 })

    // (b) custom brand SVG: create an OpenAI provider, then the admin
    // LLM-providers page must render the ported OpenAI logo (a custom <svg> whose
    // accessible <title> is "OpenAI") — proving the react-icons brand replacement.
    const adminToken = await getAdminToken(apiURL)
    const providerId = await createProviderViaAPI(
      apiURL,
      adminToken,
      `openai_${Date.now().toString(36)}`,
      'openai',
    )
    await assignProviderToAdministratorsGroup(apiURL, adminToken, providerId)

    await page.goto(`${baseURL}/settings/llm-providers`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await expect(
      page.locator('svg title', { hasText: /^OpenAI$/ }).first(),
    ).toBeAttached({ timeout: 20000 })
  })
})
