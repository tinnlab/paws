import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown } from './helpers/chat-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  mockGetMessages,
  mockUserMessage,
} from '../helpers/sse-mock-helpers'

/**
 * run_js inner-tool approval — the BEHAVIOURAL state matrix for the approval card.
 *
 * When a run_js script calls a GATED sub-tool it suspends IN-PROCESS and the
 * stream emits `runJsApprovalRequired`. Unlike the turn-boundary MCP approval,
 * this resolves via the SIDE-CHANNEL `POST /api/mcp/elicitation/{id}/respond`
 * (the same in-process oneshot ask_user uses) — so the stream stays open (no
 * `complete`) until the user answers. These specs drive the approve/deny path
 * through the real `JsToolApprovalContent` component and assert the resolve POST.
 *
 * ## Why this file exists (FIX_ROUND-18)
 *
 * The card's real invariant is *the handler POSTs in exactly the states the
 * control renders actionable*. Rounds 8-17 tried to prove that by pattern-matching
 * the component's SOURCE, and never converged — 46 of 59 findings in rounds 13-17
 * landed on `railIsolation.test.ts`, because the space of spellings is unbounded
 * (`FIX_ROUND-17.md` §7). These specs measure the property instead: for each
 * REACHABLE `blocked` state, does a POST actually leave the browser, and is the
 * control actionable. Eight mutations were applied and run against them; seven
 * turn them RED (`FIX_ROUND-18.md` §3).
 *
 * ## This file COMPLEMENTS the source guards — it does not replace them
 *
 * Round 18 deleted the guards these specs appeared to make redundant, and its own
 * blind re-audit REFUTED the deletion; it was reverted in full. Defects keyed on a
 * state these specs cannot REACH are invisible here (`FIX_ROUND-18.md` §4).
 *
 * The unreachable states, with the ACCURATE reason each is out of reach — in every
 * case it is that no browser-driven spec can invoke the mechanism, not that no
 * mechanism exists:
 *
 * - `blocked === 'no-transport'` — reachable in production (a throwing
 *   `subscribe` makes `setElicitationTransport` refuse the install; the registry's
 *   `unregister` calls `clearElicitationTransportIfOwnedBy`), but neither path is
 *   driveable from a spec.
 * - the NOT-OPEN-LOCALLY condition (`notice.status === 'not-registered'`) —
 *   genuinely reachable in production (mcp's `initialize` awaits a dynamic import
 *   before installing the transport, so a frame landing in that window is
 *   dropped), but it self-heals within the heal budget, so it is not
 *   deterministically observable.
 *
 * FIX_ROUND-20 note: that second one is no longer a `blocked` value at all — it
 * was removed from `ElicitationBlockedReason` (it had no behavioural effect) and
 * lives in `elicitationNotice`. `blocked` now has two members plus `null`, of
 * which `null` and `resolve-failed` are the two this file reaches.
 */
test.describe('run_js inner-tool approval', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(page)
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('approve: prompt resolves via side-channel /respond with accept', async ({
    page,
    testInfra,
  }) => {
    const eid = 'elic-runjs-approve'
    let respondAction: string | undefined
    let respondCount = 0
    await page.route('**/api/mcp/elicitation/*/respond', async (route) => {
      respondAction = route.request().postDataJSON()?.action
      respondCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })

    // Suspended stream: started + the approval frame, NO complete.
    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg-rj-approve' }),
        {
          event: 'runJsApprovalRequired',
          data: { elicitation_id: eid, tool_name: 'web_search', server: 'web_search', input: { query: 'x' } },
        },
      ],
    ])
    await mockGetMessages(page, [mockUserMessage({ id: 'umsg-rj-approve', text: 'run a script' })])

    await goToNewChatPage(page, testInfra.baseURL)
    await sendChatMessage(page, 'run a script')

    const prompt = page.locator(`[data-testid="run-js-approval-${eid}"]`).first()
    await expect(prompt).toBeVisible({ timeout: 30000 })

    const approve = page.locator(`[data-testid="run-js-approval-approve-${eid}"]`)
    const deny = page.locator(`[data-testid="run-js-approval-deny-${eid}"]`)

    // FIX_ROUND-7: pin the ACCESSIBLE NAMES. kit Button derives `aria-label` from
    // a string tooltip when no explicit `aria-label` is given — and these controls
    // give none — so a tooltip makes both controls announce identically and become
    // indistinguishable to a screen reader (WCAG 2.5.3 / 4.1.2).
    //
    // MEASURED LIMIT (FIX_ROUND-19). This assertion does NOT catch the regression
    // it was written for. FIX_ROUND-5's tooltip was CONDITIONAL on the degraded
    // state — `tooltip={blocked ? '…' : undefined}` — and this test runs at
    // `blocked === null`, where it evaluates to `undefined`. Re-adding it in its
    // historical spelling leaves this whole file GREEN (3 passed). The property
    // is now held by the COMPONENT HARNESS
    // (`src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx`),
    // which requires the two controls to announce DISTINCT accessible names —
    // the regression itself, rather than one syntax that causes it — and is
    // measured RED for the tooltip mutation by `scripts/mutate-approval-card.mjs`
    // (`A11Y-a`). The SOURCE guard that used to hold it is deleted. What this
    // line pins is an UNCONDITIONAL tooltip, and distinct names in the healthy state.
    // (`FIX_ROUND-8.md` §0 is the round where exactly this confusion — a control
    // that went red for a mutation that was not the regression — was first caught.)
    await expect(approve).toHaveAccessibleName(/approve/i)
    await expect(deny).toHaveAccessibleName(/deny/i)
    // Healthy transport -> both actionable, and no description pointing at an
    // empty status region.
    await expect(approve).toBeEnabled()
    await expect(deny).toBeEnabled()
    await expect(approve).not.toHaveAttribute('aria-describedby', /./)

    // TEST-MATRIX (FIX_ROUND-18): blocked === null.
    //
    // Double-click deliberately: a single-use elicitation must be POSTed EXACTLY
    // once in this state.
    //
    // MEASURED LIMIT — do not over-trust this line. Deleting the handler's
    // `setSubmitting(true)` leaves the WHOLE FILE green (FIX_ROUND-18 §3,
    // mutation A, re-run against all three tests). Here the second POST is
    // prevented by the PROVIDER, not by the in-flight flag:
    // `McpComposer.resolveElicitation` performs its optimistic `set()`
    // synchronously, so the entry flips to `accepted`, the seam bumps, and both
    // controls un-render inside the first discrete event. That happens whether or
    // not the handler has a re-entrancy gate at all — so this assertion cannot
    // enforce its stated subject in general. The flag only matters where the
    // optimistic update is a no-op (the not-open-locally condition, unreachable
    // here), and it is pinned BEHAVIOURALLY by the component harness
    // (`JsToolApprovalContent.test.tsx` §5), which holds the resolve in flight
    // with a never-settling provider and requires exactly one POST across three
    // clicks. `scripts/mutate-approval-card.mjs` (`REENTRANCY-a`) is the proof.
    await approve.dblclick()

    await expect.poll(() => respondAction, { timeout: 5000 }).toBe('accept')
    await expect(page.locator(`[data-testid="run-js-approval-status-${eid}"]`)).toHaveAttribute(
      'data-status',
      'approved',
      { timeout: 5000 },
    )
    // Settle, then assert the count — not just that a POST happened.
    await page.waitForTimeout(500)
    expect(respondCount, 'a single-use elicitation must be POSTed exactly once').toBe(1)
  })

  /**
   * TEST-MATRIX (FIX_ROUND-18): blocked === 'resolve-failed'.
   *
   * THE state this card has been broken in five times. A non-404 failure rolls
   * the store entry back to `pending` (`mcpComposer/actions/resolveElicitation`),
   * so `resolveDidFail` is true and the card enters `resolve-failed` — which is
   * RECOVERABLE by design: the controls must stay ENABLED and a second click must
   * genuinely POST again.
   *
   * FIX_ROUND-4 latched the card here (disabled on any blocked reason, and the
   * disable gated its own reset, so the card was dead for the life of the mount);
   * -5, -6, -7 and -8 each re-broke or re-fixed some part of it. Every one of
   * those was found by reading code. This measures the actual behaviour: fail the
   * first POST, assert the card is still answerable, answer it, assert the second
   * POST really goes out and the card resolves.
   */
  test('resolve-failed: a rejected POST leaves the card answerable, and the retry POSTs', async ({
    page,
    testInfra,
  }) => {
    const eid = 'elic-runjs-retry'
    const actions: string[] = []
    await page.route('**/api/mcp/elicitation/*/respond', async (route) => {
      actions.push(route.request().postDataJSON()?.action)
      // First attempt fails (not 404 -> the store rolls back to 'pending');
      // the retry succeeds.
      if (actions.length === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })

    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg-rj-retry' }),
        {
          event: 'runJsApprovalRequired',
          data: { elicitation_id: eid, tool_name: 'web_search', server: 'web_search', input: {} },
        },
      ],
    ])
    await mockGetMessages(page, [mockUserMessage({ id: 'umsg-rj-retry', text: 'run a script' })])

    await goToNewChatPage(page, testInfra.baseURL)
    await sendChatMessage(page, 'run a script')

    const approve = page.locator(`[data-testid="run-js-approval-approve-${eid}"]`)
    const deny = page.locator(`[data-testid="run-js-approval-deny-${eid}"]`)
    const status = page.locator(`[data-testid="run-js-approval-status-${eid}"]`)
    await expect(page.locator(`[data-testid="run-js-approval-${eid}"]`).first()).toBeVisible({
      timeout: 30000,
    })

    await approve.click()
    await expect.poll(() => actions.length, { timeout: 10000 }).toBe(1)

    // The card must report the failure AND remain answerable.
    //
    // Attribution, stated precisely (FIX_ROUND-19): `toBeVisible()` reads box +
    // visibility and `toBeEnabled()` reads the native `disabled` property — so
    // between them they catch an un-render and a `disabled` latch, but NEITHER can
    // observe `pointer-events-none`, which is what actually inerts a loading kit
    // Button (its `<button>` branch deliberately excludes `loading` from
    // `disabled`). What proves reachability is the `approve.click()` below, whose
    // actionability check times out on an inert control.
    await expect(status).toHaveAttribute('data-status', 'resolve-failed', { timeout: 10000 })
    await expect(approve).toBeVisible()
    await expect(deny).toBeVisible()
    await expect(approve).toBeEnabled()
    await expect(deny).toBeEnabled()

    // …and the retry must actually leave the browser.
    await approve.click()
    await expect.poll(() => actions.length, { timeout: 10000 }).toBe(2)
    expect(actions).toEqual(['accept', 'accept'])
    await expect(status).toHaveAttribute('data-status', 'approved', { timeout: 10000 })
  })

  test('deny: prompt resolves via /respond with decline', async ({ page, testInfra }) => {
    const eid = 'elic-runjs-deny'
    let respondAction: string | undefined
    await page.route('**/api/mcp/elicitation/*/respond', async (route) => {
      respondAction = route.request().postDataJSON()?.action
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })

    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg-rj-deny' }),
        {
          event: 'runJsApprovalRequired',
          data: { elicitation_id: eid, tool_name: 'web_search', server: 'web_search', input: {} },
        },
      ],
    ])
    await mockGetMessages(page, [mockUserMessage({ id: 'umsg-rj-deny', text: 'run a script' })])

    await goToNewChatPage(page, testInfra.baseURL)
    await sendChatMessage(page, 'run a script')

    await expect(page.locator(`[data-testid="run-js-approval-${eid}"]`).first()).toBeVisible({
      timeout: 30000,
    })
    await page.locator(`[data-testid="run-js-approval-deny-${eid}"]`).click()

    await expect.poll(() => respondAction, { timeout: 5000 }).toBe('decline')
    await expect(page.locator(`[data-testid="run-js-approval-status-${eid}"]`)).toHaveAttribute(
      'data-status',
      'denied',
      { timeout: 5000 },
    )
  })
})

async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const authData = await page.evaluate(() => localStorage.getItem('auth-storage'))
  return JSON.parse(authData!).state.token
}

async function sendChatMessage(page: import('@playwright/test').Page, text: string) {
  await selectModelInDropdown(page, 'GPT-4o Mini')
  const textarea = page.locator('textarea[placeholder*="Type your message"]').first()
  await textarea.fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}
