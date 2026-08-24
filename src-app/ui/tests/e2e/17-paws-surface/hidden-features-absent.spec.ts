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

/**
 * Every route a hidden module owns, plus the removed templates page, paired with
 * a text fragment that ONLY that feature's own page renders. Both halves are
 * asserted: no router 403, and no feature page either.
 */
const HIDDEN_ROUTES: [string, string][] = [
  ['/knowledge', 'Knowledge'],
  ['/scheduled-tasks', 'Scheduled Tasks'],
  ['/hub', 'Hub'],
  ['/settings/citations', 'Citations'],
  ['/settings/file-rag-admin', 'Document RAG'],
  ['/settings/js-tool', 'Programmatic Tools'],
  ['/settings/voice', 'Voice Dictation'],
  ['/settings/workflows', 'Workflows'],
  ['/settings/workflows-admin', 'System Workflows'],
  ['/settings/scheduler', 'Scheduler'],
  ['/settings/assistant-templates', 'Assistant Templates'],
]

/**
 * Nav / settings labels that must not appear anywhere in the shell.
 *
 * These are the modules' REAL slot labels, read from each `module.tsx`. An
 * earlier draft guessed `'Knowledge Bases'` — the knowledge-base module's label
 * is `'Knowledge'` — so that entry could never have failed.
 *
 * Most of these are admin-page slots gated on `FileRagAdminRead` /
 * `VoiceAdminRead` / `JsToolSettingsRead` / `AssistantsTemplateRead`, which is
 * why the label sweep below runs as an ADMIN. As a permission-less user they
 * would be absent on `main` too, and the assertion would prove nothing.
 */
const HIDDEN_LABELS = [
  'Knowledge',
  'Scheduled Tasks',
  'Assistant Templates',
  'Document RAG',
  'Voice Dictation',
  'Programmatic Tools',
  'Workflows',
  // The admin-slot labels too — a partial restore that brought back only the
  // admin pages would otherwise sail through this sweep.
  'System Workflows',
  'Scheduler',
  'Citations',
  'Hub',
]

/**
 * Chunk-name fragments for the hub SUB-modules.
 *
 * `chunkFileNames` turns a module's directory path into an underscore-joined
 * chunk name, so `hub/modules/installed/module.tsx` ships as
 * `module.hub_modules_installed.<hash>.js`. The plain `hub` entry in
 * HIDDEN_MODULE_DIRS does not match those, so the six separately-hidden
 * sub-modules would otherwise sit outside the assertion's key space entirely.
 */
const HIDDEN_SUBMODULE_CHUNKS = [
  'hub_modules_installed',
  'hub_modules_assistants',
  'hub_modules_llm-models',
  'hub_modules_mcp',
  'hub_modules_skill',
  'hub_modules_workflow',
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
  test('no hidden module chunk is ever downloaded — AS AN ADMIN', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    const requested = trackModuleRequests(page)

    // As an ADMIN, and this matters more here than anywhere else in the file.
    // An earlier draft used a `[]`-permission user, and 10 of these 14 entries
    // could not have failed for such a user: the original predicates (preserved
    // in each module.tsx comment) required HubModelsRead / VoiceAdminRead /
    // JsToolSettingsRead / FileRagAdminRead, so those chunks would never have
    // been requested with or without the reduction. Only the four gated on a
    // bare `ctx.isAuthenticated` were load-bearing. The admin holds `*`.
    await loginAsAdmin(page, baseURL)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible({
      timeout: 15000,
    })

    // The six hub SUB-modules are additionally location-scoped (`/hub` or
    // `/hub/*`), so visiting `/hub` is what would pull them if they were not
    // hidden. Without this navigation their assertions are unfalsifiable too.
    await page.goto(`${baseURL}/hub`)
    await page.waitForTimeout(2000)
    await page.goto(`${baseURL}/`)

    // Bounded settle rather than networkidle: the sync SSE stream is always
    // open, so networkidle never arrives.
    await page.waitForTimeout(2500)

    for (const name of [...HIDDEN_MODULE_DIRS, ...HIDDEN_SUBMODULE_CHUNKS]) {
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

  test('no hidden feature has a nav or settings entry — AS AN ADMIN', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    // Deliberately an ADMIN, not the permission-less user the other specs use.
    // Most hidden entries are admin-page slots; a `[]`-permission user would not
    // see them on `main` either, so asserting their absence as that user proves
    // nothing. The admin holds `*` — if any hidden surface survives, it shows up
    // here. (This is the gap that let a surviving hub surface through review.)
    await loginAsAdmin(page, baseURL)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible({
      timeout: 15000,
    })

    await page.goto(`${baseURL}/settings`)
    await page.waitForTimeout(2500)

    // POSITIVE CONTROL FIRST: the settings surface really rendered for this
    // admin, and shows an entry that SHOULD be there.
    await expect(
      page.getByText('Assistants', { exact: true }).first(),
      'the settings page must render for the admin — otherwise every absence ' +
        'assertion below is vacuous',
    ).toBeVisible({ timeout: 15000 })

    for (const label of HIDDEN_LABELS) {
      await expect(
        page.getByText(label, { exact: true }),
        `"${label}" must not appear in the shell, even for an admin`,
      ).toHaveCount(0)
    }
  })

  test('onboarding offers no Install-from-Hub section to an admin', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    // The hub is hidden (design item 11), but this section lives inside the
    // SURVIVING onboarding guide module — no module predicate, chat glob or
    // project registry reaches it, and its only gate was a hub permission that
    // administrators hold via the `*` wildcard.
    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/onboarding`)

    // Drive to the MCP Servers step. `loginAsAdmin` completes onboarding, so
    // `/onboarding` opens on step 0 (Welcome) and the MCP step never mounts —
    // an earlier draft asserted the absence right here and therefore passed on
    // `main`, before the fix it was written to prove even existed. Click through
    // until the step is actually on screen.
    const mcpStep = page.getByTestId('onboarding-step-mcp-servers')
    for (let i = 0; i < 6 && !(await mcpStep.isVisible().catch(() => false)); i++) {
      await page.getByTestId('onboarding-page-next-button').click()
      await page.waitForTimeout(800)
    }

    // POSITIVE CONTROL: the step under test is genuinely mounted. Without this
    // the assertions below are satisfied by any page that isn't it.
    await expect(
      mcpStep,
      'the MCP Servers onboarding step must be reached — otherwise this spec ' +
        'asserts the absence of a section that was never going to render',
    ).toBeVisible({ timeout: 15000 })

    // …and its BODY must have finished loading. The `onboarding-step-*` wrapper
    // is rendered by OnboardingPage OUTSIDE the step component, so it goes
    // visible while the step is still a spinner — in which state no prose exists
    // and both absence assertions below resolve trivially. Waiting for the
    // surviving sentence is the control that closes that window.
    await expect(
      mcpStep.getByText(/Toggle the ones you want to use/),
      'the step body must have rendered its prose before absence is asserted',
    ).toBeVisible({ timeout: 15000 })

    // Both the section AND the sentence that advertises it. Gating the list but
    // leaving the prose two lines above it still tells the admin to go to a Hub
    // this instance does not have.
    await expect(
      page.getByText('Install from Hub', { exact: true }),
      'onboarding must not offer a hub install list when the hub is hidden',
    ).toHaveCount(0)
    await expect(
      mcpStep.getByText(/from the Hub/i),
      'onboarding must not point the admin at the Hub in prose either',
    ).toHaveCount(0)
  })

  test('a hidden route renders neither the feature nor the router 403', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    // As an ADMIN: a permission-less user would be refused these routes anyway,
    // so only an admin can distinguish "absent" from "gated".
    await loginAsAdmin(page, baseURL)

    // POSITIVE CONTROL FIRST — routing works and a SURVIVING settings route
    // renders its own content. Without this, every assertion below is satisfied
    // by an app whose router is simply broken.
    await page.goto(`${baseURL}/settings/assistants`)
    await expect(
      page.getByText('Assistants', { exact: true }).first(),
      'a surviving route must render its page — otherwise "hidden route shows ' +
        'nothing" is indistinguishable from "nothing renders at all"',
    ).toBeVisible({ timeout: 15000 })

    for (const [route, featureText] of HIDDEN_ROUTES) {
      await page.goto(`${baseURL}${route}`)
      await page.waitForTimeout(1500)

      // (a) the in-place 403 claims the user lacks permission for a feature
      // this instance does not have.
      await expect(
        page.getByTestId('router-route-forbidden-result'),
        `${route} must not render the router 403 — the feature is absent on ` +
          `paws, not permission-gated`,
      ).toHaveCount(0)

      // (b) and the feature's OWN page must not have rendered either. Asserting
      // only (a) was hollow: it is equally satisfied by the hidden page
      // rendering in full.
      await expect(
        page.getByText(featureText, { exact: true }),
        `${route} must not render the ${featureText} surface`,
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
