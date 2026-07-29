import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'

/**
 * TEST-13 / TEST-14 / TEST-15 — the deterministic reproduction of the live-rig
 * defect (triage §4 Rank 1 / Rank 2), driven end to end against a real backend.
 *
 * The reported chain:
 *
 *   a dynamic import fails (a transport blip, OR any deploy while a tab is open)
 *     → ModelPicker.getModelId()/defaultModelId() rejects
 *     → ChatExtensionRegistry.composeRequestFields CATCHES + console.errors + CONTINUES
 *     → returns fields silently missing `model_id`
 *     → sendMessage spreads them into the POST behind `as any`
 *     → the server answers 422 "missing field `model_id`"
 *
 * The blip cannot be replayed by waiting for one, so it is INJECTED at the one
 * place it actually happens: the ES-module request for the model picker's lazy
 * ACTION modules. Vite serves each store action as its own module (in a
 * production build, its own hashed chunk), so aborting that request is exactly
 * what a stale-deploy chunk 404 or a proxy hiccup does.
 *
 * NOTE ON `page.route`: this spec mocks NO API response. The ONLY route it
 * intercepts is a static ES-module URL under `/src/modules/...`, asserted
 * non-`/api/` below — the backend, the conversation, the provider and the model
 * are all real.
 */

const SEND_ROUTE = /\/api\/conversations\/[^/]+\/messages$/

/**
 * The model extension's lazily-imported action modules — the failure point.
 *
 * The e2e stack serves a real production BUILD via `vite preview`, so these are
 * per-action HASHED chunks (`/assets/getModelId-BESpIz75.js`), exactly the URLs a
 * deploy invalidates for an already-open tab. The dev-server form is matched too
 * so the spec still works if it is ever pointed at `vite dev`; `blockedUrls`
 * below asserts the injection actually fired either way.
 */
const MODEL_ACTION_MODULE =
  /\/(assets\/(getModelId|defaultModelId)-[^/]+\.js|src\/modules\/user-llm-providers\/modelPicker\/actions\/(getModelId|defaultModelId)\.ts)/

async function seedProviderAndModel(apiURL: string) {
  const token = await getAdminToken(apiURL)
  const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
  await assignProviderToAdministratorsGroup(apiURL, token, providerId)
  await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  return token
}

async function seedConversation(
  page: import('@playwright/test').Page,
  apiURL: string,
  token: string,
  title: string,
) {
  const created = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  expect(created.ok()).toBeTruthy()
  return (await created.json()) as { id: string; active_branch_id: string }
}

/**
 * Shared arrange step: real provider+model, real login, real conversation, and
 * the fault injection armed. Returns handles the individual tests assert on.
 *
 * Each `test` below arranges its own stack (Playwright gives every test its own
 * backend + database here) so a failure in one CANNOT hide the others — the
 * whole point of splitting them.
 */
async function arrange(
  page: import('@playwright/test').Page,
  testInfra: { baseURL: string; apiURL: string },
  title: string,
) {
  const { baseURL, apiURL } = testInfra

  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  // Every import ATTEMPT the dispatcher makes raises `vite:preloadError`, and
  // the framework's listener logs one line per event — a direct, in-page
  // observation of "did the dispatcher try again?".
  //
  // Scoped to ONE chunk. Used only to prove the fault injection reached the
  // module loader at all; it is deliberately NOT used as a "did the dispatcher
  // retry?" discriminator — see the note in TEST-14 for why that assertion was
  // removed rather than kept.
  const importAttempts: string[] = []
  page.on('console', m => {
    const t = m.text()
    if (t.includes('[chunk-recovery]') && t.includes('getModelId')) {
      importAttempts.push(t)
    }
  })

  let sendRequests = 0
  const sendBodies: string[] = []
  page.on('request', r => {
    if (r.method() === 'POST' && SEND_ROUTE.test(r.url())) {
      sendRequests++
      sendBodies.push(r.postData() ?? '')
    }
  })

  const token = await seedProviderAndModel(apiURL)
  await loginAsAdmin(page, baseURL)
  const conv = await seedConversation(page, apiURL, token, title)

  const state = { blocked: true, blockedUrls: [] as string[] }
  await page.route(MODEL_ACTION_MODULE, async route => {
    if (!state.blocked) return route.fallback()
    const url = route.request().url()
    // Guardrail: this spec must never intercept an API route (R2-5).
    expect(new URL(url).pathname.startsWith('/api/')).toBe(false)
    state.blockedUrls.push(url)
    return route.abort('failed')
  })

  await page.goto(`${baseURL}/chat/${conv.id}`)
  const textarea = byTestId(page, 'chat-message-textarea')
  await expect(textarea).toBeVisible({ timeout: 30000 })

  return {
    state,
    textarea,
    pageErrors,
    importAttempts,
    counts: {
      get sends() {
        return sendRequests
      },
      bodies: sendBodies,
    },
  }
}

test.describe('Chat — a failed request-field composition never reaches the wire', () => {
  test('TEST-13: a blocked lazy action aborts the send and surfaces an ACTIONABLE error', async ({
    page,
    testInfra,
  }) => {
    const a = await arrange(page, testInfra, 'compose-failure-abort')

    await a.textarea.click()
    await a.textarea.fill('this send must not leave the browser')
    await a.textarea.press('Enter')

    const errorSurface = page
      .locator('[data-testid="chat-conversation-error-alert"], [data-sonner-toast]')
      .first()
    await expect(errorSurface).toBeVisible({ timeout: 30000 })
    const errorText = ((await errorSurface.textContent()) || '').toLowerCase()

    // The message must name the failing capability AND prescribe the action that
    // actually fixes THIS cause (a chunk load failure -> reload). Asserted as
    // separate requirements rather than one loose OR.
    //
    // `chat extension` — not `model` — is the discriminating fragment: the raw
    // cause string already contains the chunk name `getModelId`, so a lowercased
    // `toContain('model')` would stay green even if the head naming the failing
    // extension were dropped entirely.
    expect(errorText, 'the message must attribute the failure to an extension').toContain(
      'chat extension',
    )
    expect(errorText, 'and it must name which one').toContain('"model"')
    expect(errorText, 'a chunk-load failure must prescribe a reload').toMatch(/reload/)
    expect(
      errorText,
      'the user must never be shown the raw 422 validation string',
    ).not.toContain('missing field')

    expect(
      a.state.blockedUrls.length,
      'the fault injection must have actually fired (otherwise this test proves nothing)',
    ).toBeGreaterThan(0)
    expect(
      a.counts.sends,
      'a failed field composition must not produce a send request',
    ).toBe(0)
  })

  test('TEST-15: the composer is not wedged and the draft survives the abort', async ({
    page,
    testInfra,
  }) => {
    const a = await arrange(page, testInfra, 'compose-failure-composer')

    await a.textarea.click()
    await a.textarea.fill('draft that must survive')
    await a.textarea.press('Enter')

    await expect(
      page
        .locator('[data-testid="chat-conversation-error-alert"], [data-sonner-toast]')
        .first(),
    ).toBeVisible({ timeout: 30000 })

    await expect(a.textarea).toBeEnabled()
    await expect(a.textarea).toHaveValue('draft that must survive')
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({ timeout: 30000 })
  })

  test('TEST-14: repeated failures stay off the wire, and the prescribed recovery works', async ({
    page,
    testInfra,
  }) => {
    const a = await arrange(page, testInfra, 'compose-failure-recovery')

    await a.textarea.click()
    await a.textarea.fill('first attempt')
    await a.textarea.press('Enter')

    await expect
      .poll(() => a.importAttempts.length, { timeout: 30000 })
      .toBeGreaterThan(0)

    // Repeated attempts, all of which must stay off the wire.
    //
    // NOT asserted here: "the dispatcher re-attempts the import". That claim was
    // drafted for this test and then REMOVED, because the negative control
    // disproved it as a discriminator — with the old memoize-forever policy
    // deliberately reinstated, this page still emitted fresh chunk-load events on
    // every send (the composer's per-pane store, and therefore its dispatchers,
    // do not necessarily survive the failure re-render, so a fresh memo appears
    // either way). An assertion that passes with the defect present proves
    // nothing and inflates coverage. The dispatcher's never-memoize property is
    // pinned where it IS observable and IS discriminating — the unit layer,
    // `src/api-client/lazy-dispatch.test.ts` TEST-6/TEST-6b, both verified red
    // under exactly that mutation. What this test owns is the user-visible
    // contract below: repeated failures never reach the wire, and the recovery
    // the message prescribes actually works.
    for (let send = 0; send < 3; send += 1) {
      await a.textarea.press('Enter')
      await page.waitForTimeout(1500)
    }

    expect(a.counts.sends, 'no failed attempt may produce a send request').toBe(0)

    // The recovery the message PROMISES must actually work. A reload is the only
    // complete recovery available in a browser: once a module URL's fetch has
    // failed, the HTML module map records the failure for that URL and `import()`
    // of the SAME specifier will not re-request it (visible in this very run —
    // the retries above raise a fresh preloadError each time but stop hitting the
    // network). A bundler-rewritten static specifier cannot be cache-busted from
    // the dispatcher, and auto-reloading would destroy the composer draft
    // (DEC-3). So the dispatcher guarantees it never ADDS its own permanent memo,
    // and the user is told the one thing that does work — asserted here rather
    // than asserting a self-heal a browser cannot deliver.
    a.state.blocked = false
    await page.reload()
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })
    await textarea.click()
    await textarea.fill('this one should go through')
    await textarea.press('Enter')

    await expect
      .poll(() => a.counts.sends, {
        message:
          'after reloading (the recovery the error message tells the user to perform) the send must go through',
        timeout: 30000,
      })
      .toBe(1)

    // …and it carried the field whose absence was the original defect.
    const body = JSON.parse(a.counts.bodies[0] || '{}')
    expect(
      typeof body.model_id === 'string' && body.model_id.length > 0,
      `the recovered send must carry a model_id (body was ${a.counts.bodies[0]})`,
    ).toBe(true)
  })

  test('TEST-17: a blocked chunk raises NO uncaught page error anywhere', async ({
    page,
    testInfra,
  }) => {
    // Distinct property, distinct assertion: the boot-time lazy-action PREFETCH
    // warms every chunk fire-and-forget, so a blocked chunk used to produce
    // unhandled rejections from `autoWarmLazyActions` alone — its try/catch only
    // ever caught a SYNCHRONOUS throw while `preload()` returns a promise.
    const a = await arrange(page, testInfra, 'compose-failure-no-page-errors')

    await a.textarea.click()
    await a.textarea.fill('trigger the whole failure path')
    await a.textarea.press('Enter')
    await expect(
      page
        .locator('[data-testid="chat-conversation-error-alert"], [data-sonner-toast]')
        .first(),
    ).toBeVisible({ timeout: 30000 })

    // Give the idle prefetch a chance to run and fail against blocked chunks.
    await page.waitForTimeout(2000)

    expect(
      a.pageErrors,
      'a handled chunk failure must never surface as an uncaught page error',
    ).toEqual([])
  })
})
