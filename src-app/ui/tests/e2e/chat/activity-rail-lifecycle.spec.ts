import { test, expect } from '../../fixtures/test-context'
import {
  TEST_LLM,
  NO_LLM_SKIP,
  setupControlChat,
} from '../control/helpers/control-llm-helpers'
import { sendChatMessage } from './helpers/chat-helpers'
import { byTestId } from '../testid'

/**
 * TEST-4 [acceptance, INV-4] — THE LIFECYCLE, against a REAL model.
 *
 * INV-4: "The rail is open while the turn is working and collapsed once the
 * answer exists."
 *
 * This is the one rail invariant that genuinely cannot be seeded. A live
 * "Running…" step exists only in the SSE-fed live-step source; a persisted
 * `tool_use`/`tool_result` pair cannot express it, and a scripted stream would
 * be asserting the mock's timing rather than the product's. So this drives a
 * real model through the real chat path and watches the transition.
 *
 * Gating follows `control/helpers/control-llm-helpers.ts` exactly: run against
 * WHATEVER LLM the environment configures, skip ONLY when nothing at all is —
 * never a vendor-specific skip.
 *
 * The tools are `control_mcp`'s READ-ONLY `list_capabilities`, which needs no
 * network, no rootfs and no embedding model, so it is the one tool family that
 * is reliably invokable in an e2e backend.
 */

test.describe('Activity rail — open while working, collapsed once answered (INV-4)', () => {
  test.skip(!TEST_LLM, NO_LLM_SKIP)
  // Real-LLM + live SSE: multi-round tool calling is non-deterministic, so
  // retry like the other real-backend specs.
  test.describe.configure({ retries: 2 })
  test.slow()

  test('the rail is EXPANDED while the turn streams and COLLAPSES to one summary line once the answer arrives', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await setupControlChat(page, baseURL, apiURL, 'Rail Lifecycle Model')

    // Two searches ⇒ at least two tool steps ⇒ the multi-step RAIL shape, which
    // is the only shape that HAS an open/collapsed state to observe. A single
    // step renders as one always-visible quiet line by design (DEC-3), so a
    // one-call turn could not falsify this invariant either way.
    await sendChatMessage(
      page,
      'Using your app-control tools, first list the capabilities matching ' +
        '"project", then separately list the capabilities matching "assistant". ' +
        'Finish by telling me how many you found for each.',
      false,
    )

    const rail = page.locator('[data-testid="activity-rail"]').last()

    // ── WHILE WORKING ──────────────────────────────────────────────────────
    // The rail must be OPEN at a moment when the turn is still streaming. Both
    // halves are checked in ONE evaluation so a rail that only opened after the
    // stream ended cannot satisfy it.
    await page.waitForFunction(
      () => {
        const busy = document.querySelector(
          '[data-testid="chat-busy-indicator"][data-busy="streaming"]',
        )
        const open = document.querySelector('[data-testid="activity-rail"][data-open]')
        return !!busy && !!open
      },
      undefined,
      { timeout: 180000 },
    )
    // While open, the step rows are actually rendered — "open" is not just an
    // attribute.
    await expect(
      page.locator('[data-testid="activity-rail"][data-open] [data-testid="rail-step"]').first(),
    ).toBeVisible({ timeout: 30000 })

    // ── ONCE THE ANSWER EXISTS ─────────────────────────────────────────────
    // Streaming has ended when the composer re-enables.
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({
      timeout: 240000,
    })
    await expect(
      page.locator('[data-testid="chat-busy-indicator"][data-busy="streaming"]'),
    ).toHaveCount(0, { timeout: 30000 })

    // The model must actually have used tools — otherwise there is no rail and
    // the assertions below would pass vacuously.
    await expect(rail).toBeVisible({ timeout: 30000 })
    await expect(
      rail,
      'the prompt asks for two separate lookups, so the turn must produce a ' +
        'multi-step rail — a single quiet line has no collapsed state to prove',
    ).toHaveAttribute('data-rail-shape', 'rail')

    // A turn whose steps all succeeded must collapse. (A failed/timed-out step
    // FORCES it open — that is INV-5, proven by activity-rail-failure.spec.ts —
    // so a forced-open rail here means the model's tool call errored, which is
    // a real failure of this test's premise, not of the invariant.)
    await expect(
      rail,
      'no step failed, so nothing may force the rail open',
    ).not.toHaveAttribute('data-forced-open', '')

    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toHaveAttribute('aria-expanded', 'false', {
      timeout: 30000,
    })
    // Collapsed means the machinery is GONE from the transcript, not merely
    // styled small.
    await expect(rail.getByTestId('activity-rail-steps')).toHaveCount(0)
    await expect(rail.getByTestId('rail-step')).toHaveCount(0)

    // ONE line: the summary occupies a single line box.
    const summaryLines = await summary.evaluate(el => el.getClientRects().length)
    expect(summaryLines).toBe(1)
    await expect(summary).toHaveText(/step|steps/)

    // …and the collapse is user-reversible — the audit path stays open.
    await summary.click()
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await expect(rail.getByTestId('rail-step').first()).toBeVisible()

    // The ANSWER itself is present and outside the rail (INV-6's neighbour).
    const answer = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
    await expect(answer).toContainText(/\w/)
  })
})
