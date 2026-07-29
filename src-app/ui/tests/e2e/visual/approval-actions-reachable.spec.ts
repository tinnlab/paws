import { test, expect, type Locator, type Page } from '@playwright/test'
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
  const card = page.getByTestId('mcp-tool-approval-card').first()
  // Same bounded re-navigation as `openSurface` below, for the same
  // environmental reason (see its comment: dynamic module import fails
  // intermittently when the host's inotify instance limit is exhausted by
  // concurrent Vite servers). Nothing about the assertions changes.
  await gotoUntilVisible(page, SURFACE, card)
  return card
}

/**
 * Navigate, then wait for `target` — retrying the WHOLE navigation a bounded
 * number of times.
 *
 * This is an ENVIRONMENT workaround, not a softened assertion. The gallery loads
 * app modules by dynamic import from the Vite dev server, and on a box running
 * many worktrees concurrently that import intermittently fails outright:
 *
 *   [loader] failed to load module "mcp" TypeError: Failed to fetch dynamically
 *   imported module: http://localhost:<port>/modules/mcp/module.tsx
 *   Error: EMFILE: too many open files, watch '…/vite-plugin-form-names.js'
 *
 * The root cause is the kernel's `fs.inotify.max_user_instances` (128 on this
 * host) being exhausted by the file watchers of concurrent Vite servers — not
 * anything in the app. When the `mcp` module fails to load, no content renderer
 * is registered and the message falls back to the dispatcher's "Unknown content
 * type" placeholder, so the card never mounts at all. Reproduced on the
 * UNTOUCHED base commit too (2 bad loads in 32), i.e. wholly independent of the
 * change under test; measured per-load failure rate ~2 in 15.
 *
 * A retry is the right response because the failure is in FETCHING the app, not
 * in what the app renders: each attempt is a fresh, full navigation, and if the
 * surface genuinely never renders every attempt fails and so does the test.
 */
async function gotoUntilVisible(page: Page, url: string, target: Locator) {
  const attempts = 4
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.goto(url)
      await target.waitFor({
        state: 'visible',
        timeout: attempt === attempts - 1 ? RENDER_TIMEOUT : 12_000,
      })
      return
    } catch (e) {
      last = e
    }
  }
  throw last
}

/* ────────────────────────────────────────────────────────────────────────────
 * TEST-1 … TEST-7 — the decision controls stay reachable at NARROW widths too.
 *
 * TEST-10b above asserts reachability on ONE axis (vertical) at ONE viewport
 * (1280x900). It passed for months while, at a 390px viewport, the approval
 * card's action row was pushing two of its three controls clean off the
 * inline-start edge. That is the shape of a test that certifies a bug: the
 * assertion was true and the property it was supposed to protect was false.
 *
 * The mechanism: the footer's action row was `flex justify-end` with no wrap,
 * holding kit Buttons (`shrink-0 whitespace-nowrap`) whose intrinsic total
 * (81 + 140 + 251 + gaps = 488px) exceeded the 238px content box. `justify-end`
 * sends that overflow out of the inline-START edge, where the Card root's
 * `overflow-hidden` clips it to zero AND no scroll can reach it (a start-edge
 * overflow creates no scrollable region: `scrollWidth === clientWidth`).
 * Measured pre-fix, in both themes:
 *
 *   tool-approval-deny          x=[-174,-93] w=81  visibleW=0   hitsSelf=false
 *   tool-approval-approve-once  x=[-85,55]   w=140 visibleW=0   hitsSelf=false
 *   tool-approval-approve-conv  x=[63,314]   w=251 visibleW=251 hitsSelf=true
 *
 * i.e. the only pressable control was the BROADEST approval. A user on a phone
 * could approve a tool call for the whole conversation but could not deny it.
 *
 * These tests therefore assert REACHABILITY, never DOM presence — every control
 * was in the DOM and `toBeVisible()` the entire time the bug shipped. Reachable
 * means: the control's box survives the intersection of its non-scrolling
 * clipping ancestors (taxonomy A11), its centre hit-tests back to itself, and
 * Playwright can actually click it.
 * ──────────────────────────────────────────────────────────────────────────── */

const MOBILE = { width: 390, height: 844 }
const THEMES = ['light', 'dark'] as const

type Reach = {
  width: number
  visibleWidth: number
  height: number
  visibleHeight: number
  top: number
}

/**
 * The pressability proof: Playwright's own actionability check.
 *
 * A trial click performs every check a real click does — scroll into view, wait
 * for a stable box, and hit-test the action point so an element covered by an
 * overlay fails — and retries until the timeout, without dispatching the event.
 * That is a stricter and far less brittle statement of "a user can press this"
 * than a one-shot `elementFromPoint` sample, which races the message list's
 * mount-time auto-scroll.
 *
 * Crucially it is NOT satisfied by mere DOM presence: every control in this
 * defect was present, `toBeVisible()`, and had a non-empty bounding box the
 * entire time it was unreachable. What fails here is a control whose action
 * point cannot be brought on screen — exactly the pre-fix Deny.
 */
async function expectPressable(scope: Locator, testId: string, why: string) {
  await test.step(`${testId} is pressable (${why})`, async () => {
    await scope
      .getByTestId(testId)
      .first()
      .click({ trial: true, timeout: 8_000 })
  })
}

/**
 * Measure a control against the REAL clipping-ancestor chain.
 *
 * "Reachable" is deliberately defined as *a user could get to it and press it*,
 * so the measurement must distinguish the two kinds of overflow:
 *
 *  - an ancestor that can SCROLL on an axis (`overflow: auto/scroll`, or
 *    `hidden` with content that genuinely overflows, i.e. a programmatic
 *    scroller) does NOT hide anything — the content is one gesture away. The
 *    approval card lives inside exactly such a list (`overflow-y: auto`), so
 *    counting it as a clip would flag every below-the-fold control as a defect.
 *  - an ancestor that clips on an axis with NOTHING to scroll to
 *    (`overflow: hidden/clip` and `scrollExtent <= clientExtent`) hides content
 *    permanently. That is the taxonomy A11 predicate, and it is precisely the
 *    condition the live rig reported: "cut to 0 by a non-scrollable overflow
 *    ancestor", "no horizontal scroll to reveal it".
 *
 * The geometry is taken AFTER `scrollIntoViewIfNeeded()`, so being merely
 * scrolled-out-of-view is never counted as unreachable; only content that no
 * scroll can reveal fails. Coverage by an overlay is checked separately, by
 * `expectPressable`.
 */
async function measureReach(scope: Locator, testId: string): Promise<Reach> {
  const control = scope.getByTestId(testId).first()
  // A user can scroll. Do so first, so the measurement is of true reachability
  // rather than of the list's current scroll offset. This also settles the
  // message list's mount-time auto-scroll before anything is sampled.
  await control.scrollIntoViewIfNeeded()
  return control.evaluate(el => {
    const r = el.getBoundingClientRect()
    let clip = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight }
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      const pr = p.getBoundingClientRect()
      const clipsX =
        (cs.overflowX === 'hidden' || cs.overflowX === 'clip') &&
        p.scrollWidth <= p.clientWidth + 1
      const clipsY =
        (cs.overflowY === 'hidden' || cs.overflowY === 'clip') &&
        p.scrollHeight <= p.clientHeight + 1
      if (clipsX) {
        clip.l = Math.max(clip.l, pr.left)
        clip.r = Math.min(clip.r, pr.right)
      }
      if (clipsY) {
        clip.t = Math.max(clip.t, pr.top)
        clip.b = Math.min(clip.b, pr.bottom)
      }
    }
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      visibleWidth: Math.round(
        Math.max(0, Math.min(r.right, clip.r) - Math.max(r.left, clip.l)),
      ),
      visibleHeight: Math.round(
        Math.max(0, Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t)),
      ),
      top: Math.round(r.top),
    }
  })
}

/** Open a gallery deep-state and wait for its approval card's action row. */
async function openSurface(page: Page, surface: string, theme: string) {
  await gotoUntilVisible(
    page,
    `/gallery.html?surface=${surface}&theme=${theme}`,
    page.locator('[data-slot="card-actions"]').first(),
  )
}

const APPROVAL_CONTROLS = [
  'tool-approval-deny',
  'tool-approval-approve-once',
  'tool-approval-approve-conv',
] as const

for (const theme of THEMES) {
  test.describe(`approval actions at 390px (${theme})`, () => {
    test(`TEST-1: every decision control on the approval card is REACHABLE, not merely rendered (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE)
      await openSurface(page, 'deep-chat-tool-approval', theme)
      const card = page.getByTestId('mcp-tool-approval-card').first()

      for (const id of APPROVAL_CONTROLS) {
        // The property the invariant is about: the user can press it. Pre-fix,
        // Deny and "Approve once" sat at x=[-174,-93] and x=[-85,55] with zero
        // visible width and no scroll able to reveal them, leaving the BROADEST
        // approval as the only pressable control.
        await expectPressable(card, id, 'approval card at 390px')
      }
    })

    test(`TEST-2: no decision control is clipped by a non-scrolling ancestor (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE)
      await openSurface(page, 'deep-chat-tool-approval', theme)
      const card = page.getByTestId('mcp-tool-approval-card').first()

      for (const id of APPROVAL_CONTROLS) {
        const m = await measureReach(card, id)
        expect(
          m.visibleWidth,
          `${id}: ${m.width - m.visibleWidth}px of its ${m.width}px width is cut off by a non-scrolling clipping ancestor (taxonomy A11)`,
        ).toBe(m.width)
        expect(
          m.visibleHeight,
          `${id}: ${m.height - m.visibleHeight}px of its ${m.height}px height is cut off by a non-scrolling clipping ancestor`,
        ).toBe(m.height)
      }
    })

    test(`TEST-3: the row resolves the overflow by WRAPPING, leaving none hidden (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE)
      await openSurface(page, 'deep-chat-tool-approval', theme)
      const card = page.getByTestId('mcp-tool-approval-card').first()
      const row = card.locator('[data-slot="card-actions"]').first()

      expect(
        await row.evaluate(el => getComputedStyle(el).flexWrap),
        'the action row must be allowed to wrap',
      ).toBe('wrap')

      // It actually DID wrap here — three controls do not fit a 390px card, so
      // if they are all on one line something is overflowing rather than
      // wrapping. (Guards a "fix" that only widened the container.)
      const tops = new Set<number>()
      for (const id of APPROVAL_CONTROLS) {
        tops.add((await measureReach(card, id)).top)
      }
      expect(
        tops.size,
        'at 390px the three decision controls cannot share one line; they must wrap onto more than one',
      ).toBeGreaterThan(1)

      // …and nothing is parked in an unreachable overflow region. This is the
      // measurement that made the original defect invisible to scrolling:
      // scrollWidth === clientWidth even while 250px of content sat outside.
      const box = await row.evaluate(el => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }))
      expect(
        box.scroll,
        'the action row must not carry hidden horizontal overflow',
      ).toBeLessThanOrEqual(box.client + 1)
    })
  })
}

test('TEST-4: at desktop width the approval action row is unchanged — one right-aligned line, Deny first', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openSurface(page, 'deep-chat-tool-approval', 'light')
  const card = page.getByTestId('mcp-tool-approval-card').first()

  const measured = []
  for (const id of APPROVAL_CONTROLS) {
    measured.push({ id, ...(await measureReach(card, id)) })
  }
  // One line: the wrap rule is inert when the content fits, so a wide card
  // renders exactly as it did before this fix.
  expect(
    new Set(measured.map(m => m.top)).size,
    'at 1280px all three controls must still share a single line',
  ).toBe(1)
  for (const m of measured) {
    expect(m.visibleWidth, `${m.id} must be fully visible at desktop width`).toBe(
      m.width,
    )
    await expectPressable(card, m.id, 'approval card at 1280px')
  }
  // Reading order preserved: Deny leads, and visual order matches DOM order, so
  // tab order and reading order do not diverge.
  const lefts = await card.evaluate(el =>
    [...el.querySelectorAll('[data-slot="card-actions"] > button')].map(b =>
      Math.round(b.getBoundingClientRect().left),
    ),
  )
  expect(lefts, 'controls must render in DOM order, left to right').toEqual(
    [...lefts].sort((a, b) => a - b),
  )
})

for (const theme of THEMES) {
  test(`TEST-5: the elicitation card's footer controls are reachable and on the shared primitive (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-elicitation', theme)
    const card = page.getByTestId('mcp-elicitation-pending-card').first()

    // The sibling is on the SHARED primitive, not a hand-rolled `justify-end`
    // row — so it cannot silently drift back onto the broken pattern.
    await expect(card.locator('[data-slot="card-actions"]')).toHaveCount(1)

    for (const id of ['elicitation-decline', 'elicitation-submit']) {
      const m = await measureReach(card, id)
      expect(m.visibleWidth, `${id} must not be clipped at 390px`).toBe(m.width)
      await expectPressable(card, id, 'elicitation card at 390px')
    }
  })

  test(`TEST-6: the ask-user wizard's split footer stays reachable and its nested group wraps (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-ask-user-wizard', theme)
    const card = page.getByTestId('mcp-elicitation-pending-card').first()
    const row = card.locator('[data-slot="card-actions"]').first()

    // The split layout survives adopting the primitive: Decline on the
    // inline-start side, navigation on the inline-end side.
    expect(await row.evaluate(el => getComputedStyle(el).justifyContent)).toBe(
      'space-between',
    )

    // The NESTED navigation group is its own flex container, so the primitive's
    // wrap rule does not reach its buttons — it must wrap on its own.
    const nested = row.locator('> div').first()
    expect(
      await nested.evaluate(el => getComputedStyle(el).flexWrap),
      'the nested navigation group must wrap too',
    ).toBe('wrap')

    // Whichever controls this step renders must all be pressable.
    let checked = 0
    for (const id of [
      'elicitation-decline',
      'elicitation-back',
      'elicitation-next',
      'elicitation-submit',
    ]) {
      if ((await card.getByTestId(id).count()) === 0) continue
      const m = await measureReach(card, id)
      expect(m.visibleWidth, `${id} must not be clipped at 390px`).toBe(m.width)
      await expectPressable(card, id, 'ask-user wizard at 390px')
      checked++
    }
    expect(checked, 'the wizard footer must render controls to check').toBeGreaterThan(1)
  })
}

for (const theme of THEMES) {
  test(`TEST-8: at 390px the approval card still shows WHICH tool is being approved (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-tool-approval', theme)
    const card = page.getByTestId('mcp-tool-approval-card').first()

    // Same failure class as the footer, different row: the header's two
    // secondary labels are `whitespace-nowrap` and together need 205px of a
    // 238px row, so on ONE line they starved the tool NAME to a rendered width
    // of 0 while its text stayed in the DOM. The card then read
    // "(Acme Weather) — needs approval" with no indication of WHICH tool.
    //
    // Note what this does NOT assert: `toContainText('get_forecast')` — the
    // pre-existing TEST-11 does that, and it passed throughout the defect,
    // because the string was present and merely unrenderable. Consent requires
    // the name be SEEN, so the assertion is on rendered width.
    const name = card.getByText('get_forecast', { exact: true }).first()
    const m = await name.evaluate(el => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), scrollW: el.scrollWidth }
    })
    expect(
      m.w,
      `the tool name is rendered ${m.w}px wide (it needs ${m.scrollW}px) — the user cannot see which tool they are approving`,
    ).toBeGreaterThan(0)
    // Not merely non-zero: the name must be legible, not a sliver. Allow an
    // ellipsis for a genuinely long name, but require most of it to show.
    expect(m.w).toBeGreaterThanOrEqual(Math.min(m.scrollW, 60))
    await expect(name).toBeVisible()
  })
}

test('TEST-7: the desktop-vertical assertion and the narrow-width assertions measure DIFFERENT things', async ({
  page,
}) => {
  // The regression this whole block exists for is that a green reachability
  // suite covered only one axis at one viewport. Pin the distinction so a future
  // edit cannot collapse the narrow tests back into the desktop one: at 390px
  // the SAME control that TEST-10b certifies as vertically in-fold is the one
  // that was horizontally unreachable. Here we assert the narrow measurement is
  // genuinely taken at a narrow width and genuinely constrains the horizontal
  // axis — i.e. the card is narrower than the controls' intrinsic total.
  await page.setViewportSize(MOBILE)
  await openSurface(page, 'deep-chat-tool-approval', 'light')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  const row = card.locator('[data-slot="card-actions"]').first()

  const rowWidth = await row.evaluate(el => el.clientWidth)
  expect(
    rowWidth,
    'the mobile surface must actually be narrow, or these tests prove nothing',
  ).toBeLessThan(390)

  let intrinsic = 0
  for (const id of APPROVAL_CONTROLS) {
    intrinsic += (await measureReach(card, id)).width
  }
  expect(
    intrinsic,
    'the controls must genuinely not fit one line here — otherwise the wrap path is never exercised',
  ).toBeGreaterThan(rowWidth)
})

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
