import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  textDeltaEvent,
  completeEvent,
} from '../helpers/sse-mock-helpers'
import { byTestId } from '../testid'

/**
 * REGRESSION GUARDS for the ROUND-2 composer / geometry findings from the
 * `live-ui-audit` battery:
 *
 *   - `stuck-loading`     — after a rapid double-submit the send button spun
 *     forever and an orphan, never-filled assistant bubble was left behind.
 *   - `zero-size-control` — an interactive control measured 1×1 px on `home`@390.
 *     This spec DISPOSES that finding with evidence rather than silencing it.
 */

test.describe('live-ui-audit round 2 — composer + geometry', () => {
  test('TEST-9: a rapid double-submit produces exactly ONE turn and leaves the composer usable', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')

    const mock = await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg_dbl_1' }),
        textDeltaEvent({ delta: 'Exactly one answer.', messageId: 'amsg_dbl_1' }),
        completeEvent({ finishReason: 'end_turn' }),
      ],
    ])

    // Count the REAL conversation creations too: the pre-fix race could create a
    // second conversation, because the whole `POST /api/conversations` round-trip
    // sat inside the unguarded window.
    const conversationCreates: string[] = []
    page.on('request', req => {
      const u = new URL(req.url())
      if (req.method() === 'POST' && u.pathname === '/api/conversations') {
        conversationCreates.push(u.pathname)
      }
    })

    await page.goto(`${baseURL}/`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    const composer = byTestId(page, 'chat-message-textarea')
    await expect(composer).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(1500)

    // The audit's LITERAL repro (`adversarial-compose` → `rapid-double-submit`):
    // fill, Enter, Enter — with no wait in between, so the second keypress lands
    // inside the window the first send spends in its pre-`sending:true` awaits.
    await composer.fill('rapid test 🚀 <script>x</script> "quoted" \\n')
    await composer.press('Enter')
    await composer.press('Enter')

    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(4000)

    expect(
      mock.sendCount(),
      `a double keypress must send exactly one message; sent ${mock.sendCount()}`,
    ).toBe(1)
    expect(
      conversationCreates.length,
      `a double keypress must create exactly one conversation; created ${conversationCreates.length}`,
    ).toBe(1)
    await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="chat-message"][data-role="assistant"]')).toHaveCount(1)

    // The `stuck-loading` signal itself: after the turn ends the composer must be
    // usable and nothing in it may still be spinning.
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({ timeout: 30000 })
    const spinning = page.locator('[data-chat-composer] .animate-spin')
    await expect(spinning).toHaveCount(0)
  })

  test('TEST-8 [acceptance INV-4]: the 1×1 control at 390px is a WORKING WCAG bypass link', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })

    const skip = page.getByRole('link', { name: /skip to content/i })

    // At rest it is visually hidden — which is EXACTLY why the audit's geometry
    // pass measures it at 1×1 px. That is the `sr-only` contract, not a defect.
    await expect(skip).toHaveCount(1)
    const atRest = await skip.boundingBox()
    expect(atRest, 'the skip link must exist in the DOM at rest').not.toBeNull()
    expect(atRest!.width).toBeLessThanOrEqual(2)
    expect(atRest!.height).toBeLessThanOrEqual(2)

    // Keyboard-focused, it becomes a REAL, reachable target. If it did not — if
    // the `focus:not-sr-only` escape were broken — the finding would be a genuine
    // defect and this assertion is what says so.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    const focused = await skip.boundingBox()
    expect(focused, 'a focused skip link must be laid out').not.toBeNull()
    expect(
      focused!.width,
      'a focused bypass link needs a real tap target (WCAG 2.5.8 minimum 24px)',
    ).toBeGreaterThanOrEqual(24)
    expect(focused!.height).toBeGreaterThanOrEqual(24)

    // ...and it does its job: activating it targets the main-content landmark.
    await expect(skip).toHaveAttribute('href', '#main-content')
    await expect(page.locator('#main-content')).toHaveCount(1)
  })
})
