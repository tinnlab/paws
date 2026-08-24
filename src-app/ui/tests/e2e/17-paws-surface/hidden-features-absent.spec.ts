import { test, expect } from '../../fixtures/test-context'
import type { Page } from '@playwright/test'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'

/**
 * TEST-2 [acceptance] [invariant: INV-1] — a hidden feature's UI is ABSENT:
 * no nav entry, no route, no slot contribution, no composer affordance. Not
 * merely visually suppressed.
 *
 * "Not merely visually suppressed" is why the primary assertion is that the
 * module's CHUNK IS NEVER REQUESTED. A CSS-hidden or permission-gated entry
 * would still download its module; an absent one cannot. The e2e runs a prod
 * build, so each module is its own hashed chunk and the request log is a direct
 * observation of what the browser was handed.
 *
 * The route assertions are the second half: a hidden module's `routePaths` stay
 * in the build manifest, so before this change `/knowledge` rendered the router's
 * in-place 403 — telling the user they lacked PERMISSION for a feature this
 * instance does not have.
 */

/** Which module chunks the browser requested. Mirrors 16-smart-loading. */
function trackModuleRequests(page: Page): { has: (name: string) => boolean } {
  const urls: string[] = []
  page.on('request', r => urls.push(r.url()))
  return {
    has: (name: string) =>
      urls.some(
        u =>
          new RegExp(`/modules/(?:[^?]*/)?${name}/module\\.tsx`).test(u) ||
          new RegExp(`/module\\.${name}\\.[A-Za-z0-9_-]+\\.js`).test(u),
      ),
  }
}

/** Directory names of every module the paws reduction hides. */
const HIDDEN_MODULE_DIRS = [
  'workflow',
  'scheduler',
  'citations',
  'knowledge-base',
  'file-rag',
  'hub',
  'voice',
  'js-tool',
]

/** Every route a hidden module owns, plus the removed templates page. */
const HIDDEN_ROUTES = [
  '/knowledge',
  '/scheduled-tasks',
  '/hub',
  '/settings/citations',
  '/settings/file-rag-admin',
  '/settings/js-tool',
  '/settings/voice',
  '/settings/workflows',
  '/settings/scheduler',
  '/settings/assistant-templates',
]

/** Nav / settings labels that must not appear anywhere in the shell. */
const HIDDEN_LABELS = [
  'Knowledge Bases',
  'Scheduled Tasks',
  'Assistant Templates',
  'Document RAG',
  'Voice Dictation',
  'Programmatic Tools',
]

const PASSWORD = 'PawsSurfaceUser12345'

async function signInFreshUser(
  page: Page,
  baseURL: string,
  apiURL: string,
  username: string,
) {
  await loginAsAdmin(page, baseURL)
  const adminToken = await getAdminToken(apiURL)
  await createTestUser(
    apiURL,
    adminToken,
    username,
    `${username}@test.local`,
    PASSWORD,
    [],
  )
  await login(page, baseURL, username, PASSWORD, { completeOnboarding: true })
  await expect(page.locator('[data-testid="app-root"]')).toBeVisible({
    timeout: 15000,
  })
}

test.describe('paws feature surface — hidden features are absent (INV-1)', () => {
  test('an ordinary user never downloads a hidden module', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const requested = trackModuleRequests(page)
    await signInFreshUser(page, baseURL, apiURL, 'pawshidden')

    // Bounded settle rather than networkidle: a fresh no-permission user churns
    // on the sync SSE stream, so networkidle never arrives. A hidden module's
    // chunk would be requested during this initial wave if the gate were broken.
    await page.waitForTimeout(2500)

    for (const name of HIDDEN_MODULE_DIRS) {
      expect(
        requested.has(name),
        `the "${name}" module chunk must never be downloaded — INV-1 requires ` +
          `the feature to be absent, not hidden`,
      ).toBe(false)
    }

    // POSITIVE CONTROL: a surviving module IS downloaded. Without this the loop
    // above would pass on a blank page, a failed login, or a broken tracker.
    expect(
      requested.has('chat'),
      'the chat module must still load — otherwise this test proves nothing',
    ).toBe(true)
  })

  test('no hidden feature has a nav or settings entry', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await signInFreshUser(page, baseURL, apiURL, 'pawsnav')

    await page.goto(`${baseURL}/settings`)
    await page.waitForTimeout(2500)

    for (const label of HIDDEN_LABELS) {
      await expect(
        page.getByText(label, { exact: true }),
        `"${label}" must not appear in the shell`,
      ).toHaveCount(0)
    }

    // POSITIVE CONTROL: the settings surface really rendered.
    await expect(
      page.getByText('Assistants', { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 })
  })

  test('a hidden route is not-found, NOT the router 403', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await signInFreshUser(page, baseURL, apiURL, 'pawsroutes')

    for (const route of HIDDEN_ROUTES) {
      await page.goto(`${baseURL}${route}`)
      await page.waitForTimeout(1500)

      // The specific regression: the in-place 403 claims the user lacks
      // permission for a feature that does not exist on this instance.
      await expect(
        page.getByTestId('router-route-forbidden-result'),
        `${route} must not render the router 403 — the feature is absent on ` +
          `paws, not permission-gated`,
      ).toHaveCount(0)
    }
  })

  test('no hidden feature registers a chat extension', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    // The chat-extension registry logs every extension it discovers, which is a
    // DIRECT observation of the filter's effect: an extension that is registered
    // contributes its composer pill, toolbar row, panel renderer and rail steps
    // to chat whether or not any of them happen to be rendered right now.
    //
    // Asserting on the registration rather than on rendered buttons is
    // deliberate. Two earlier drafts asserted the affordances were not VISIBLE —
    // first on guessed accessible names, then on the components' real testids —
    // and a mutation probe that DISABLED the filter passed both, because those
    // affordances need conditions (an open plus-menu, an existing conversation,
    // a live voice capability) that the spec does not create. Both were hollow.
    // This one fails under that same probe.
    const discovered: string[] = []
    page.on('console', m => {
      const t = m.text()
      if (t.includes('[Chat Extensions] Discovered:')) discovered.push(t)
    })

    await signInFreshUser(page, baseURL, apiURL, 'pawscomposer')
    await page.goto(`${baseURL}/`)
    await page.waitForTimeout(3000)

    // POSITIVE CONTROL first: discovery ran at all. Without this every assertion
    // below passes on a page where chat never loaded.
    expect(
      discovered.length,
      'chat-extension discovery must have run — otherwise this proves nothing',
    ).toBeGreaterThan(0)

    // The glob keys as they appear in the log: sibling-module extensions are
    // `../../<dir>/chat-extension/extension.tsx`, chat-owned ones
    // `./<dir>/extension.tsx`.
    for (const owner of [
      '../../citations/chat-extension',
      '../../knowledge-base/chat-extension',
      '../../workflow/chat-extension',
      '../../scheduler/chat-extension',
      '../../js-tool/chat-extension',
      './schedule/extension.tsx', // chat-OWNED: the scheduler's composer affordance
      './voice/extension.tsx', // chat-OWNED: the dictation mic
    ]) {
      const hit = discovered.filter(l => l.includes(owner))
      expect(
        hit,
        `"${owner}" must not register a chat extension — it is the composer ` +
          `half of a hidden feature, and the module predicate cannot reach it`,
      ).toEqual([])
    }

    // POSITIVE CONTROL: surviving extensions ARE still discovered, so the filter
    // is selective rather than switching the whole registry off (INV-2).
    for (const owner of [
      './text/extension.tsx',
      '../../file/chat-extension',
      // literature is a DISABLE-ONLY row in the design's item table (item 2):
      // the capability is off server-side but its UI is not hidden, so its chat
      // extension must still register. If this fails, the reduction has quietly
      // exceeded the design.
      '../../literature/chat-extension',
    ]) {
      expect(
        discovered.some(l => l.includes(owner)),
        `"${owner}" must still register — the filter must not disable chat`,
      ).toBe(true)
    }
  })
})
