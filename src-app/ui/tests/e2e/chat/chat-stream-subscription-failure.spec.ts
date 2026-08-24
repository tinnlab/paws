import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'

/**
 * TEST-11 — acceptance test for INV-4: "a realtime delivery failure must not
 * present to the user as 'still working'."
 *
 * `PUT /api/chat/stream/subscription` is the only thing that scopes a chat-token
 * connection to a conversation. If it never lands, the SSE connection stays open
 * and perfectly healthy while `publish_frame` matches no connection — every live
 * token is dropped at the registry, the reply persists anyway, and the user sees
 * a spinner that only a reload resolves.
 *
 * That is precisely what shipped: the desktop webview is cross-origin to the
 * embedded server, and `X-Chat-Stream-Connection-Id` was missing from the CORS
 * allow-list, so the browser refused the preflight. A preflight refusal REJECTS
 * `fetch` — it is not a status — so it missed the client's `!resp.ok` branch and
 * was swallowed by a `console.warn`.
 *
 * Playwright's `route.abort()` produces exactly that shape: a rejected request
 * with no response. (The CORS cause itself cannot be reproduced here — the web
 * e2e is same-origin, so there is no preflight at all. It is covered where it
 * actually lives, by TEST-1/TEST-3 against the real CORS layer.)
 *
 * The failing clause each assertion isolates:
 *   - the spinner stops        → the turn is not still claiming to generate;
 *   - the error is RENDERED    → the user is told, not left guessing;
 *   - the composer is usable   → they can act on it.
 * Each alone passes while the surface is still broken, so they are asserted
 * together — mirroring `failed-stream-error-state.spec.ts`, the sibling spec for
 * the same class of defect.
 */

const SUBSCRIPTION_ROUTE = /\/api\/chat\/stream\/subscription$/

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

test.describe('Chat — an undeliverable stream is surfaced, not silent', () => {
  test('a subscription that can never succeed reaches a visible terminal state', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'stream-subscription-failure')

    // Fail the ONE boundary under test, permanently. `abort` (not a 4xx) is the
    // preflight-refusal shape: the request never reaches the server and `fetch`
    // rejects rather than resolving.
    let attempts = 0
    await page.route(SUBSCRIPTION_ROUTE, async (route, req) => {
      if (req.method() === 'PUT') {
        attempts += 1
        return route.abort('failed')
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)

    // Opening a conversation is itself what triggers the subscription
    // (`loadConversation` → `setActiveConversation`), so no send is needed for
    // the failure to occur — which is the honest reproduction: the stream is
    // already undeliverable before the user types anything.
    const alert = byTestId(page, 'chat-conversation-error-alert')
    await expect(alert).toBeVisible({ timeout: 30000 })
    const alertText = (await alert.innerText()).trim()
    expect(alertText.length, 'the error alert must not be blank').toBeGreaterThan(0)
    expect(alertText).toMatch(/live updates/i)

    // The client really did retry before giving up — a single attempt would mean
    // the reconnect path never ran (which is the pre-fix behaviour: the swallowed
    // catch never aborted the stream, so it never reconnected and never re-PUT).
    expect(attempts).toBeGreaterThanOrEqual(3)

    // Nothing is left claiming to generate…
    await expect(byTestId(page, 'chat-streaming-indicator')).toHaveCount(0)
    await expect(page.locator('[data-busy="streaming"]')).toHaveCount(0)

    // …and the user can still act.
    await expect(byTestId(page, 'chat-message-textarea')).toBeEnabled({ timeout: 30000 })
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled()

    // It stays terminal — no spinner creeps back after a settle window.
    await page.waitForTimeout(3000)
    await expect(byTestId(page, 'chat-streaming-indicator')).toHaveCount(0)
  })

  test('POSITIVE CONTROL: a healthy subscription raises no error banner', async ({
    page,
    testInfra,
  }) => {
    // Without this, "the banner appears" would be satisfied by a banner that
    // appears always — and the whole spec would pass with the feature deleted.
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'stream-subscription-ok')

    await page.goto(`${baseURL}/chat/${conv.id}`)

    // Watch the real subscription PUT go out and come back, in a real browser.
    // This is the one browser-level assertion that the client half of INV-2
    // works end to end: it issues the PUT, carrying the connection-id header,
    // and the server accepts it. (The CORS cause is not reproducible here — this
    // harness is same-origin, so there is no preflight — which is why the
    // preflight itself is asserted where it lives, in TEST-1/TEST-3.)
    const subscription = page.waitForResponse(
      (r) => SUBSCRIPTION_ROUTE.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30000 },
    )

    await expect(byTestId(page, 'chat-message-textarea')).toBeVisible({ timeout: 30000 })

    const resp = await subscription
    expect(resp.status(), 'the subscription PUT must be accepted').toBeLessThan(300)
    expect(
      resp.request().headers()['x-chat-stream-connection-id'],
      'the PUT must carry the header the server keys the subscription on',
    ).toBeTruthy()

    // …and after a window comfortably longer than the failure path needs
    // (3 attempts at 1s/2s backoff), no error banner has appeared.
    await page.waitForTimeout(8000)
    await expect(byTestId(page, 'chat-conversation-error-alert')).toHaveCount(0)
  })
})
