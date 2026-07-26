import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'

/**
 * E2E — a failed turn reaches a VISIBLE terminal state, never a stuck spinner.
 *
 * TEST-7 (acceptance, INV-1) + TEST-8.
 *
 * A live-app audit reported `stuck-loading` — "3 loading indicator(s) still
 * present after settle window" — on the `sent` and `rapid-double-submit` steps
 * in 6/6 cells. A spinner that never stops is indistinguishable from "the model
 * is still thinking", so the user waits indefinitely with nothing to act on.
 *
 * INV-1 ("Always render `store.error` … Always show loading … Always show
 * success/error feedback after a mutation") is only satisfied when all three
 * hold TOGETHER at the end of a failed turn: the spinner stops, the error is
 * rendered, and the composer is usable again. TEST-7 asserts exactly that
 * conjunction — each clause alone can pass while the surface is still broken.
 *
 * TEST-8 is the positive control: it proves the indicator genuinely appears for
 * an in-flight turn, so TEST-7 cannot pass merely because the element never
 * rendered at all.
 *
 * SCOPE, stated honestly: these specs fail the send POST, which was ALREADY
 * inside the store's pre-existing try/catch — so they verify the USER-VISIBLE
 * contract (spinner stops, error shows, composer recovers) but they do NOT by
 * themselves prove the try-widening in `sendMessage`. The failures that used to
 * wedge the flags (`loadMessages` / `provideUserContent` throwing between the
 * flag-set and the old `try`) are not reachable from the network boundary; they
 * are covered by `stores/chat/sendMessage.store.test.ts`, which drives the real
 * action and was verified RED against the pre-fix code.
 */

const SEND_ROUTE = /\/api\/conversations\/[^/]+\/messages$/

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

test.describe('Chat — a failed turn shows an error, not an eternal spinner', () => {
  test('spinner stops, error is visible, composer is usable', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'failed-stream-error-state')

    // Fail the ONE boundary under test — generation never starts.
    await page.route(SEND_ROUTE, async (route, req) => {
      if (req.method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'provider unavailable' } }),
        })
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })
    await textarea.fill('generate something')
    await byTestId(page, 'chat-input-send-btn').click()

    // ── INV-1 clause 2: the loading affordance TERMINATES. ──────────────────
    await expect(byTestId(page, 'chat-streaming-indicator')).toHaveCount(0, {
      timeout: 30000,
    })

    // ── INV-1 clause 1: `store.error` is RENDERED, with real text. ──────────
    const alert = byTestId(page, 'chat-conversation-error-alert')
    await expect(alert).toBeVisible({ timeout: 30000 })
    const alertText = (await alert.innerText()).trim()
    expect(alertText.length, 'the error alert must not be blank').toBeGreaterThan(0)

    // ── INV-1 clause 3: the user can act again (retry the mutation). ────────
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({ timeout: 30000 })
    await expect(textarea).toBeEnabled()

    // And it stays terminal — no spinner creeps back after the settle window
    // (the audit's signal was measured AFTER a settle, not immediately).
    await page.waitForTimeout(3000)
    await expect(byTestId(page, 'chat-streaming-indicator')).toHaveCount(0)
  })

  test('the streaming indicator is a named affordance: present in flight, absent after failure', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const conv = await seedConversation(page, apiURL, 'streaming-indicator-lifecycle')

    // Hold the send open, THEN fail it — so the in-flight state is observable
    // before the terminal state, in one continuous turn.
    await page.route(SEND_ROUTE, async (route, req) => {
      if (req.method() === 'POST') {
        await new Promise(r => setTimeout(r, 4000))
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'provider unavailable' } }),
        })
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/chat/${conv.id}`)
    const textarea = byTestId(page, 'chat-message-textarea')
    await expect(textarea).toBeVisible({ timeout: 30000 })
    await textarea.fill('hold then fail')
    await byTestId(page, 'chat-input-send-btn').click()

    // PRESENT while the turn is in flight — and it is a real, announced
    // affordance, not an anonymous spinning div.
    const indicator = byTestId(page, 'chat-streaming-indicator')
    const region = byTestId(page, 'chat-busy-indicator')
    await expect(indicator).toBeVisible({ timeout: 15000 })

    // The live region is ALWAYS mounted (only its content toggles) — a region
    // inserted together with its text is unreliably announced.
    await expect(region).toHaveAttribute('role', 'status')
    await expect(region).toHaveAttribute('aria-live', 'polite')

    // …and it names the state it is actually in. `data-busy` distinguishes a
    // GENERATION from a plain message-history fetch, which share this spinner;
    // asserting it is what stops "visible after clicking Send" being satisfied
    // by an unrelated load.
    await expect(region).toHaveAttribute('data-busy', 'streaming')
    await expect(region).toHaveAttribute('aria-label', 'Generating response')

    // ABSENT once the turn terminates — and NOTHING on the page still claims to
    // be generating. (Asserted as a page-wide count rather than on `region`
    // itself: a terminal failure can swap the whole transcript for an error
    // state, so the region may legitimately be gone — what must never remain is
    // a live "streaming" claim.)
    await expect(indicator).toHaveCount(0, { timeout: 30000 })
    await expect(page.locator('[data-busy="streaming"]')).toHaveCount(0)
    await expect(byTestId(page, 'chat-conversation-error-alert')).toBeVisible({
      timeout: 30000,
    })
  })
})
