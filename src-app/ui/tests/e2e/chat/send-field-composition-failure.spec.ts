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

test.describe('Chat — a failed request-field composition never reaches the wire', () => {
  test('TEST-13/14/15: a blocked lazy action aborts the send, surfaces an actionable error, keeps retrying, and recovers', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(e.message))

    // Every import ATTEMPT the dispatcher makes raises `vite:preloadError`, and
    // the framework's listener logs one line per event — so this counter is a
    // direct, in-page observation of "did the dispatcher try again?", which is
    // TEST-14's property.
    const importAttempts: string[] = []
    page.on('console', m => {
      if (m.text().includes('[chunk-recovery]')) importAttempts.push(m.text())
    })

    const token = await seedProviderAndModel(apiURL)
    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, token, 'compose-failure')

    // ── Fault injection: fail the model extension's lazy action modules ──────
    // `blocked` is flipped off later in the test, which is what TEST-14 needs.
    let blocked = true
    const blockedUrls: string[] = []
    await page.route(MODEL_ACTION_MODULE, async route => {
      if (!blocked) return route.fallback()
      const url = route.request().url()
      // Guardrail: this spec must never intercept an API route (R2-5).
      expect(new URL(url).pathname.startsWith('/api/')).toBe(false)
      blockedUrls.push(url)
      return route.abort('failed')
    })

    let sendRequests = 0
    page.on('request', r => {
      if (r.method() === 'POST' && SEND_ROUTE.test(r.url())) sendRequests++
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })

    await textarea.click()
    await textarea.fill('this send must not leave the browser')
    await textarea.press('Enter')

    // ── TEST-13: the send is ABORTED, not sent with an invalid body ──────────
    // A visible, actionable error surface appears (the conversation error Alert
    // and/or the composer's toast) …
    const errorSurface = page
      .locator(
        '[data-testid="chat-conversation-error-alert"], [data-sonner-toast]',
      )
      .first()
    await expect(errorSurface).toBeVisible({ timeout: 30000 })
    const errorText = ((await errorSurface.textContent()) || '').toLowerCase()

    // … and it tells the user something they can act on, rather than echoing the
    // server's validation string.
    expect(errorText).toMatch(/reload|updated|model/)
    expect(
      errorText,
      'the user must never be shown the raw 422 validation string',
    ).not.toContain('missing field')

    // The core assertion: NOTHING structurally invalid left the browser.
    expect(
      blockedUrls.length,
      'the fault injection must have actually fired (otherwise this test proves nothing)',
    ).toBeGreaterThan(0)
    expect(
      sendRequests,
      'a failed field composition must not produce a send request',
    ).toBe(0)

    // ── TEST-15: the composer is not wedged and the draft survives ───────────
    await expect(textarea).toBeEnabled()
    await expect(textarea).toHaveValue('this send must not leave the browser')
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({
      timeout: 30000,
    })

    // ── TEST-14: the dispatcher keeps RE-ATTEMPTING; it never memoizes ──────
    // The shipped dispatcher memoized the rejection permanently: attempt 1 was
    // retried once, and from the SECOND failure on it stopped importing at all —
    // every later send failed instantly without touching the chunk. So the
    // discriminating observation is whether a THIRD send attempt still produces
    // fresh import attempts.
    const afterFirstSend = importAttempts.length
    expect(afterFirstSend).toBeGreaterThan(0)

    await textarea.press('Enter')
    await expect
      .poll(() => importAttempts.length, { timeout: 15000 })
      .toBeGreaterThan(afterFirstSend)
    const afterSecondSend = importAttempts.length

    await textarea.press('Enter')
    await expect
      .poll(() => importAttempts.length, {
        message:
          'a THIRD send must still re-attempt the import — under the shipped memoize-after-one-retry policy the dispatcher had already latched and would attempt nothing',
        timeout: 15000,
      })
      .toBeGreaterThan(afterSecondSend)

    // Still nothing invalid on the wire, three attempts in.
    expect(sendRequests, 'no failed attempt may produce a send request').toBe(0)

    // ── TEST-14 (b): the recovery the message PROMISES actually works ────────
    // The message tells the user to reload, and that is the only complete
    // recovery available in a browser: once a module URL's fetch has failed, the
    // HTML module map records the failure for that URL and `import()` of the SAME
    // specifier will not re-request it (visible in this very run — the retries
    // above raise a fresh preloadError each time but stop hitting the network).
    // A bundler-rewritten static specifier cannot be cache-busted from here, and
    // auto-reloading would destroy the composer draft (DEC-3). So the dispatcher
    // guarantees it never ADDS its own permanent memo on top of the browser's,
    // and the user is told the one thing that does work — which this asserts is
    // true, rather than asserting a self-heal that a browser cannot deliver.
    blocked = false
    await page.reload()
    const textareaAfterReload = byTestId(page, 'chat-message-textarea')
    await expect(textareaAfterReload).toBeVisible({ timeout: 30000 })
    await textareaAfterReload.click()
    await textareaAfterReload.fill('this one should go through')
    await textareaAfterReload.press('Enter')

    await expect
      .poll(() => sendRequests, {
        message:
          'after reloading (the recovery the error message tells the user to perform) the send must go through',
        timeout: 30000,
      })
      .toBe(1)

    // No uncaught exception at any point.
    expect(pageErrors, 'no uncaught exception on the abort path').toEqual([])
  })
})
