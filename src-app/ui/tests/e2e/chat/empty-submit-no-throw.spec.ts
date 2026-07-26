import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'

/**
 * E2E — the composer's Enter path never raises an uncaught exception.
 *
 * TEST-5 (acceptance, INV-2) + TEST-6.
 *
 * A live-app audit found a `🔴 HIGH page-error` — "Message cannot be empty" —
 * in 6/6 viewport × theme cells. Root cause: `TextInput.handleKeyDown` is an
 * `async` React handler that called `chatStore.sendMessage()` with NO try/catch,
 * while the store threw for every extension veto — including the routine "the
 * composer is empty" one. The rejection escaped as an unhandled promise
 * rejection, i.e. a page-level error event, with no toast for the user.
 *
 * Two properties are asserted here, and they are different:
 *   1. an EMPTY submit raises nothing at all (it is now a silent cancel the
 *      store returns from) and changes nothing;
 *   2. a NON-EMPTY submit that genuinely fails is CAUGHT and surfaced to the
 *      user — the Enter path must not become quiet about real failures while
 *      fixing the noisy one.
 */

const SEND_ROUTE = /\/api\/conversations\/[^/]+\/messages$/

/** Collect page-level errors + console errors for the life of the page. */
function collectErrors(page: import('@playwright/test').Page) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    // Ignore infrastructure noise unrelated to the composer: dev-server HMR
    // chatter and resource-load failures are not what this spec is about.
    if (/Failed to load resource|\[vite\]|favicon/i.test(t)) return
    consoleErrors.push(t)
  })
  return { pageErrors, consoleErrors }
}

async function seedConversation(
  page: import('@playwright/test').Page,
  apiURL: string,
  title: string,
) {
  const token = await getAdminToken(apiURL)
  const created = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  expect(created.ok()).toBeTruthy()
  return (await created.json()) as { id: string; active_branch_id: string }
}

test.describe('Chat — composer submit never throws', () => {
  test('pressing Enter on an EMPTY composer is a silent no-op (no pageerror)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const errors = collectErrors(page)

    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'empty-submit-no-throw')
    await page.goto(`${baseURL}/chat/${conv.id}`)

    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })

    // No send request may leave the browser for an empty submit.
    let sendRequests = 0
    page.on('request', r => {
      if (r.method() === 'POST' && SEND_ROUTE.test(r.url())) sendRequests++
    })

    const userMessagesBefore = await page.locator('[data-role="user"]').count()

    // The literal repro: focus the empty composer and hit Enter. Repeat — a
    // stray double-Enter after a send is exactly how a real user hits this.
    await textarea.click()
    await textarea.press('Enter')
    await textarea.press('Enter')
    await page.waitForTimeout(1500)

    // 1. NOTHING was raised. This is the audit finding, directly.
    expect(
      errors.pageErrors,
      'an empty submit must never raise an uncaught exception',
    ).toEqual([])
    expect(
      errors.consoleErrors,
      'an empty submit must not log an error either',
    ).toEqual([])

    // 2. It was a true no-op: no request, no message, no error surface.
    expect(sendRequests, 'an empty submit must not hit the API').toBe(0)
    expect(await page.locator('[data-role="user"]').count()).toBe(userMessagesBefore)
    await expect(byTestId(page, 'chat-conversation-error-alert')).toHaveCount(0)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)

    // 3. The composer is still usable — a no-op must not wedge anything.
    await expect(textarea).toBeEnabled()
    await textarea.fill('still works')
    await expect(textarea).toHaveValue('still works')
  })

  test('a FAILING send via Enter surfaces a toast and still raises no pageerror', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const errors = collectErrors(page)

    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'enter-send-failure')

    // Fail the ONE boundary under test: the send POST.
    await page.route(SEND_ROUTE, async (route, req) => {
      if (req.method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'send failed' } }),
        })
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })

    await textarea.click()
    await textarea.fill('this send will fail')
    await textarea.press('Enter')

    // The failure IS surfaced — the fix must not make the Enter path quiet
    // about real errors while silencing the empty-composer one.
    await expect(byTestId(page, 'chat-conversation-error-alert')).toBeVisible({
      timeout: 30000,
    })

    // …and it still did not escape as an uncaught exception.
    expect(
      errors.pageErrors,
      'a handled send failure must not surface as a page error',
    ).toEqual([])

    // The composer recovers.
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({ timeout: 30000 })
  })

  test('Enter while a turn is already in flight does not start a SECOND send', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const errors = collectErrors(page)

    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'rapid-double-submit')

    // Accept the send but never stream a terminal frame: `sending` clears while
    // `isStreaming` stays true — precisely the window in which the textarea is
    // re-enabled (it is only `disabled={sending}`) and a second Enter used to
    // fire another turn. This is the audit's `rapid-double-submit` cell.
    let sendRequests = 0
    await page.route(SEND_ROUTE, async (route, req) => {
      if (req.method() === 'POST') {
        sendRequests++
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user_message_id: '00000000-0000-4000-8000-000000000001',
            assistant_message_id: '00000000-0000-4000-8000-000000000002',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })

    await textarea.click()
    await textarea.fill('first turn')
    await textarea.press('Enter')

    // The turn is in flight (the streaming affordance is up).
    await expect(byTestId(page, 'chat-streaming-indicator')).toBeVisible({
      timeout: 30000,
    })
    expect(sendRequests).toBe(1)

    // Hammer Enter mid-turn.
    await textarea.click()
    await textarea.fill('second turn')
    await textarea.press('Enter')
    await textarea.press('Enter')
    await page.waitForTimeout(1500)

    expect(sendRequests, 'Enter must be inert while a turn is streaming').toBe(1)
    expect(errors.pageErrors).toEqual([])
  })
})
