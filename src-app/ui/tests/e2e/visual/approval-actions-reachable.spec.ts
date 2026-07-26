import { test, expect, type Page } from '@playwright/test'
import { LONG_TOOL_DESCRIPTION } from '../../../src/dev/gallery/fixtures/longToolDescription'

/**
 * Tool-approval card — the decision controls stay reachable, and the advertised
 * description stays COMPLETE.
 *
 * TEST-10 (acceptance, INV-3) + TEST-11.
 *
 * Driven against the backend-free gallery deep-state, which renders the REAL
 * `ConversationPage` through the production chat path (the same approach
 * `mermaid-toggle.spec.ts` uses). That matters twice over: the card under test is
 * the real component in its real container — a virtualized, scrolling message
 * list, which is what makes card height a layout problem at all — and the spec
 * needs no LLM bridge, so it RUNS rather than self-skipping.
 *
 * The defect: the advertised tool description was rendered raw
 * (`whitespace-pre-wrap`, no cap). A ~2,000-char description — ordinary for a
 * real MCP server, and trivially manufactured by a hostile one — grew the card
 * until Deny/Approve fell below a 1280×900 fold. That is a usability bug and a
 * safety one: pushing "Deny" off screen is the cheapest way to leave "Approve"
 * as the only action in view.
 *
 * The fix must NOT be a truncation. The card's disclosure contract is that the
 * user sees the "FULL, EXACT advertised description (never truncated/summarized
 * — poisoning hides in truncation)", so the clamp is CSS-only and the complete
 * string stays in the DOM. TEST-10 asserts BOTH halves; either alone is
 * satisfiable by a wrong implementation.
 */

const SURFACE =
  '/gallery.html?surface=deep-chat-tool-approval-long-desc&theme=light'
const RENDER_TIMEOUT = 25_000

async function openApprovalCard(page: Page) {
  await page.goto(SURFACE)
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.waitFor({ state: 'visible', timeout: RENDER_TIMEOUT })
  return card
}

test.describe('tool-approval card — actions reachable, description complete', () => {
  let pageErrors: string[]

  test.beforeEach(async ({ page }) => {
    pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e)))
  })

  test('TEST-10a: the FULL description is in the DOM while collapsed (never truncated)', async ({
    page,
  }) => {
    const card = await openApprovalCard(page)
    const desc = card.getByTestId('approval-tool-description')
    await expect(desc).toBeVisible()

    // Collapsed by default — the toggle is offered, so we know it IS clamped
    // (and therefore that the next assertion is testing the collapsed state).
    const toggle = card.getByTestId('collapsible-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveText('Show more')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The toggle is BOUND to the region it governs (assistive tech needs the
    // association, not just the label).
    const controls = await toggle.getAttribute('aria-controls')
    expect(controls, 'the toggle must reference its region').toBeTruthy()

    // …yet every character of the advertised description is still present.
    // A string truncation would fail here; a CSS clamp passes.
    expect(await desc.textContent()).toBe(LONG_TOOL_DESCRIPTION)

    // The clamp is real: the content genuinely overflows its rendered box.
    const region = card.getByTestId('collapsible-content')
    const box = await region.evaluate(el => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }))
    expect(
      box.scroll,
      'the description must actually be clamped, not merely short',
    ).toBeGreaterThan(box.client)

    expect(pageErrors, pageErrors.join('\n')).toHaveLength(0)
  })

  test('TEST-10b: the whole approval card fits a 1280x900 viewport — request AND actions visible together', async ({
    page,
  }) => {
    const VIEWPORT_H = 900
    await page.setViewportSize({ width: 1280, height: VIEWPORT_H })
    const card = await openApprovalCard(page)

    const box = await card.boundingBox()
    expect(box, 'the approval card must have a layout box').not.toBeNull()

    // The property that actually matters is that the card FITS. Asserting only
    // "the buttons are on screen" is hollow here: the message list auto-scrolls
    // to its tail, so an oversized card still ends with its footer in view — it
    // just pushes its own HEADER off the top instead. Measured on this very
    // surface: unclamped the card is 837px tall and its top sits at y=-235
    // (the tool name, the destination host and the start of the description are
    // all above the fold); clamped it is 457px tall starting at y=145. So the
    // user could always reach Approve — what they could not do is see WHAT they
    // were approving at the same time.
    expect(
      box!.y,
      'the top of the card (tool name + what is being requested) must not be scrolled off',
    ).toBeGreaterThanOrEqual(0)
    expect(
      box!.y + box!.height,
      'the bottom of the card (the Deny/Approve row) must be within the fold',
    ).toBeLessThanOrEqual(VIEWPORT_H)

    // …and both decision controls are genuinely on screen within it.
    for (const id of ['tool-approval-deny', 'tool-approval-approve-once']) {
      const btn = card.getByTestId(id)
      await expect(btn, `${id} must be rendered`).toBeVisible()
      const b = await btn.boundingBox()
      expect(b, `${id} must have a layout box`).not.toBeNull()
      expect(b!.y).toBeGreaterThanOrEqual(0)
      expect(b!.y + b!.height).toBeLessThanOrEqual(VIEWPORT_H)
    }
  })

  test('TEST-10c: "Show more" reveals the full text and can be collapsed again', async ({
    page,
  }) => {
    const card = await openApprovalCard(page)
    const desc = card.getByTestId('approval-tool-description')
    const toggle = card.getByTestId('collapsible-toggle')

    const region = card.getByTestId('collapsible-content')
    const collapsedHeight = await region.evaluate(el => el.clientHeight)

    await toggle.click()
    await expect(toggle).toHaveText('Show less')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // Expanded is genuinely unclamped — taller, and no longer overflowing.
    const expanded = await region.evaluate(el => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }))
    expect(expanded.client).toBeGreaterThan(collapsedHeight)
    expect(expanded.client).toBeGreaterThanOrEqual(expanded.scroll - 2)
    expect(await desc.textContent()).toBe(LONG_TOOL_DESCRIPTION)

    // …and it collapses back.
    await toggle.click()
    await expect(toggle).toHaveText('Show more')
    expect(await region.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(
      collapsedHeight + 2,
    )
  })

  test('TEST-11: pre-approval, the pending request is fully disclosed in-thread', async ({
    page,
  }) => {
    const card = await openApprovalCard(page)

    // The card IS the in-thread representation of the pending tool call — it
    // renders in the message transcript, not in a detached modal.
    await expect(
      page.locator('[data-role="assistant"]').filter({ has: card }).first(),
    ).toBeVisible()

    // WHAT is being requested, before the user decides:
    //  - which tool (and which server)
    await expect(card).toContainText('get_forecast')
    //  - the concrete arguments the model chose, verbatim
    const args = card.getByTestId('approval-tool-args')
    await expect(args).toBeVisible()
    await expect(args).toContainText('San Francisco, CA')
    await expect(args).toContainText('metric')
    //  - where the data goes
    await expect(card.getByTestId('approval-dest-host')).toContainText(
      'api.weather.example.com',
    )
    //  - and the tool's own advertised description
    await expect(card.getByTestId('approval-tool-description')).toBeVisible()

    // …and the decision itself.
    await expect(card.getByTestId('tool-approval-deny')).toBeVisible()
    await expect(card.getByTestId('tool-approval-approve-once')).toBeVisible()

    // The RUNNING tool card is deliberately absent while approval is pending:
    // `McpToolCallUI` early-returns the approval card for `pending_approval`, so
    // the two are mutually exclusive in the same slot rather than stacked. This
    // is the intended design a live audit measured as `toolCard=0 approval=1`;
    // pinning it here stops a refactor silently making the pending request
    // invisible in the transcript. The post-approval swap to the running card is
    // covered by `chat/mcp-tool-approval-optimistic.spec.ts`.
    await expect(page.locator('[data-testid^="mcp-toolcall-card-"]')).toHaveCount(0)

    expect(pageErrors, pageErrors.join('\n')).toHaveLength(0)
  })

  test('TEST-10d: an unbroken-token description cannot hide text horizontally', async ({
    page,
  }) => {
    const card = await openApprovalCard(page)
    const desc = card.getByTestId('approval-tool-description')

    // A height clamp alone is not enough. A hostile server can put its payload
    // in ONE unbroken token (no spaces): that renders as a single line, which
    // never overflows VERTICALLY, so the "does it overflow?" measurement says no
    // and no toggle appears — while the remainder is clipped off the right edge
    // with no cue. `break-words` is what forces such a token to wrap, so it
    // becomes tall (→ clamped, → toggled) instead of silently clipped.
    const wraps = await desc.evaluate(
      el => getComputedStyle(el).overflowWrap === 'break-word' ||
            getComputedStyle(el).wordBreak === 'break-word',
    )
    expect(wraps, 'the description must wrap unbroken tokens, not clip them').toBe(true)

    // Nothing is hidden sideways: the text never overflows its own width.
    const h = await desc.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(
      h.scroll,
      'no part of the advertised description may sit outside its box horizontally',
    ).toBeLessThanOrEqual(h.client + 1)
  })
})
