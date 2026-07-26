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
    const toggle = card.getByTestId('approval-tool-description-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveText('Show more')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // …yet every character of the advertised description is still present.
    // A string truncation would fail here; a CSS clamp passes.
    expect(await desc.textContent()).toBe(LONG_TOOL_DESCRIPTION)

    // The clamp is real: the content genuinely overflows its rendered box.
    const box = await desc.evaluate(el => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }))
    expect(
      box.scroll,
      'the description must actually be clamped, not merely short',
    ).toBeGreaterThan(box.client)

    expect(pageErrors, pageErrors.join('\n')).toHaveLength(0)
  })

  test('TEST-10b: Deny and Approve are inside a 1280x900 viewport without scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const card = await openApprovalCard(page)

    for (const id of ['tool-approval-deny', 'tool-approval-approve-once']) {
      const btn = card.getByTestId(id)
      await expect(btn, `${id} must be rendered`).toBeVisible()
      const box = await btn.boundingBox()
      expect(box, `${id} must have a layout box`).not.toBeNull()
      expect(
        box!.y + box!.height,
        `${id} must sit within the 900px fold, not below it`,
      ).toBeLessThanOrEqual(900)
      expect(box!.y, `${id} must not be scrolled off the top`).toBeGreaterThanOrEqual(0)
    }
  })

  test('TEST-10c: "Show more" reveals the full text and can be collapsed again', async ({
    page,
  }) => {
    const card = await openApprovalCard(page)
    const desc = card.getByTestId('approval-tool-description')
    const toggle = card.getByTestId('approval-tool-description-toggle')

    const collapsedHeight = await desc.evaluate(el => el.clientHeight)

    await toggle.click()
    await expect(toggle).toHaveText('Show less')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // Expanded is genuinely unclamped — taller, and no longer overflowing.
    const expanded = await desc.evaluate(el => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }))
    expect(expanded.client).toBeGreaterThan(collapsedHeight)
    expect(expanded.client).toBeGreaterThanOrEqual(expanded.scroll - 2)
    expect(await desc.textContent()).toBe(LONG_TOOL_DESCRIPTION)

    // …and it collapses back.
    await toggle.click()
    await expect(toggle).toHaveText('Show more')
    await expect(await desc.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(
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
})
