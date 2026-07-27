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
    //
    // ...plus an immediate Send-BUTTON click. The two entry points are guarded
    // by DIFFERENT code: the Enter path has `TextInput`'s own synchronous
    // `inFlightRef`, while the button path (`ChatInput.handleSend`) reads the
    // RENDERED `sending`/`isStreaming` and is therefore the path that only the
    // store-level latch in `sendMessage` can stop. Exercising Enter alone would
    // pass without that latch and prove nothing about it.
    await composer.fill('rapid test 🚀 <script>x</script> "quoted" \\n')
    await composer.press('Enter')
    await composer.press('Enter')
    await byTestId(page, 'chat-input-send-btn').click({ force: true, timeout: 2000 }).catch(() => {})

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
    // Message ROWS are deliberately not counted here, and that is not a
    // weakening — it is the only correct choice under this harness.
    // `mockChatTokenStream` intercepts `POST …/messages`, so the real backend
    // never persists the turn; the post-`complete` tail reconcile
    // (`applyStreamFrame` → `getHistory`) then correctly replaces the streamed
    // rows with the — empty — persisted tail. Measured: the assistant row is
    // visible (asserted above) and then legitimately disappears a few seconds
    // later. Counting rows would assert a property of the MOCK.
    //
    // "Exactly one turn" is proven by the two request counts above, which is
    // where the double-submit race actually shows up: pre-fix it produced a
    // second `POST /api/conversations` and a second send.

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
    await expect(skip).toHaveCount(1)

    // At rest it may legitimately be either visible (some designs show it) or
    // visually hidden. The `sr-only` case is the one the audit's geometry pass
    // measures at 1×1 px — that is the visually-hidden contract, not a defect —
    // so this test does NOT require the tiny box, it only records which case is
    // live. Requiring it would make a permanently-visible skip link (a strictly
    // better WCAG 2.4.1 outcome) fail.
    const atRest = await skip.boundingBox()
    expect(atRest, 'the skip link must be in the layout at rest').not.toBeNull()
    const hiddenAtRest = atRest!.width <= 2 && atRest!.height <= 2

    // The load-bearing half: FOCUSED, it must become a REAL, usable target.
    // This is the assertion that was RED before this branch: none of the link's
    // `focus:not-sr-only focus:absolute focus:z-50 …` utilities were emitted
    // into the CSS at all (the sdk shell package was outside Tailwind's content
    // scan), so a focused skip link still computed to `width:1px;
    // clip-path:inset(50%)` — a WCAG 2.4.1 bypass link that a sighted keyboard
    // user could never see.
    //
    // Focus is set programmatically rather than by pressing Tab: tab ORDER is
    // not what is under test here, and a browser resumes tabbing from the last
    // focused element, which makes a blur-then-Tab sequence order-dependent and
    // flaky. `.focus()` triggers `:focus` identically.
    await skip.focus()
    await expect(skip).toBeFocused({ timeout: 5000 })
    const focused = await skip.boundingBox()
    expect(focused, 'a focused skip link must be laid out').not.toBeNull()
    // 24 px is the repo's own minimum comfortable target, not a citation: WCAG
    // 2.5.8 governs POINTER targets, and at rest this control has no pointer
    // affordance at all. The point here is that focusing it produces something a
    // sighted keyboard user can actually see and hit.
    expect(
      focused!.width,
      `a focused bypass link needs a usable target (hiddenAtRest=${hiddenAtRest})`,
    ).toBeGreaterThanOrEqual(24)
    expect(focused!.height).toBeGreaterThanOrEqual(24)

    // ...and it does its job: activating it moves FOCUS into the main content
    // region, not merely the scroll position. A bypass link whose target is not
    // focusable is the classic broken implementation, and only this assertion
    // catches it.
    await expect(skip).toHaveAttribute('href', '#main-content')
    await expect(page.locator('#main-content')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused({ timeout: 5000 })
  })
})
