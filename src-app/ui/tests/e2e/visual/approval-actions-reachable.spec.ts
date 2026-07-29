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
 * in what the app renders. Two deliberate constraints keep it from turning into
 * a blanket flake-suppressor:
 *
 *  - it retries ONLY when the app itself failed to arrive — either the loader
 *    console signature was seen, or the message fell back to the content
 *    dispatcher's "Unknown content type" placeholder (what a missing `mcp`
 *    module actually renders). A surface that loads fine but fails to show the
 *    target — i.e. a genuine PRODUCT regression — is rethrown on the FIRST
 *    attempt, so this cannot launder a real flake into a pass;
 *  - each attempt gets a generous window, so ordinary slowness on a loaded box
 *    never reaches the retry path at all, and the whole budget stays inside the
 *    per-test timeout raised below — meaning the saved error is genuinely
 *    rethrown instead of the test dying opaquely on a timeout first.
 */
const LOADER_FAILURE = /failed to load module|Failed to fetch dynamically imported module|EMFILE/i

async function gotoUntilVisible(page: Page, url: string, target: Locator) {
  const attempts = 3
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    let loaderFailed = false
    const onConsole = (m: { text(): string }) => {
      if (LOADER_FAILURE.test(m.text())) loaderFailed = true
    }
    page.on('console', onConsole)
    try {
      await page.goto(url)
      await target.waitFor({ state: 'visible', timeout: 20_000 })
      return
    } catch (e) {
      last = e
      // A missing module leaves the content dispatcher with nothing to render.
      const unregistered =
        loaderFailed ||
        (await page.getByText('Unknown content type').count().catch(() => 0)) > 0
      // The app arrived but the target did not → a real render problem. Surface
      // it immediately rather than retrying it away.
      if (!unregistered) throw e
    } finally {
      page.off('console', onConsole)
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
 * clipping ancestors (taxonomy A11), and Playwright's actionability check —
 * scroll into view, wait for a stable box, hit-test the action point — lets it
 * be clicked.
 * ──────────────────────────────────────────────────────────────────────────── */

// These specs drive the heaviest gallery deep-states (a full ConversationPage
// through the real chat path) and may re-navigate up to 3x when the dev server
// fails to serve a module (see `gotoUntilVisible`). The default 60s leaves no
// room for that, and a budget overrun would mask the real error behind an opaque
// timeout.
test.describe.configure({ timeout: 150_000 })

const MOBILE = { width: 390, height: 844 }
const THEMES = ['light', 'dark'] as const

type Reach = {
  width: number
  visibleWidth: number
  height: number
  visibleHeight: number
  top: number
  left: number
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
 *  - an ancestor the USER can scroll (`overflow: auto` or `scroll`) does NOT
 *    hide anything — the content is one gesture away. The approval card lives
 *    inside exactly such a list (`overflow-y: auto`), so counting it as a clip
 *    would flag every below-the-fold control as a defect.
 *  - an ancestor with `overflow: hidden` or `clip` ALWAYS clips, whether or not
 *    its content overflows. `overflow: hidden` is not user-scrollable — no
 *    scrollbar, no wheel, no touch pan — even though it is programmatically
 *    scrollable, which is why `scrollWidth > clientWidth` must NOT be read as
 *    "reachable". Getting this wrong would let the mirror image of the very
 *    defect under test (an END-edge overflow of the same row) measure green,
 *    since both `scrollIntoViewIfNeeded` and Playwright's actionability scroll
 *    happily scroll a hidden box that no user can. This is the taxonomy A11
 *    predicate and matches what the live rig reported: "cut to 0 by a
 *    non-scrollable overflow ancestor", "no horizontal scroll to reveal it".
 *
 * The geometry is taken AFTER `scrollIntoViewIfNeeded()`, so being merely
 * scrolled-out-of-view is never counted as unreachable; only content that no
 * scroll can reveal fails. Coverage by an overlay is checked separately, by
 * `expectPressable`.
 */
async function measureRow(
  scope: Locator,
  testIds: readonly string[],
): Promise<Record<string, Reach>> {
  // A user can scroll. Do so ONCE, for the whole row, so every rect below is
  // read at the SAME scroll offset and the values are mutually comparable. This
  // also settles the message list's mount-time auto-scroll before sampling.
  await scope.scrollIntoViewIfNeeded()
  return scope.evaluate((root, ids) => {
    const measure = (el: Element) => {
      const r = el.getBoundingClientRect()
      // Deliberately NOT seeded with the viewport rect. The viewport is not a
      // permanent clip — a scrollable ancestor brings content into it — so
      // including it would report every below-the-fold control as "cut off by a
      // non-scrolling ancestor", which is both a wrong diagnosis and a latent
      // false failure. Reachability INTO the viewport is proved separately, and
      // properly, by `expectPressable` (Playwright scrolls, then hit-tests).
      const clip = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        const pr = p.getBoundingClientRect()
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
          clip.l = Math.max(clip.l, pr.left)
          clip.r = Math.min(clip.r, pr.right)
        }
        if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
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
        left: Math.round(r.left),
      }
    }
    const out: Record<string, ReturnType<typeof measure>> = {}
    for (const id of ids) {
      const el = root.querySelector(`[data-testid="${id}"]`)
      if (el) out[id] = measure(el)
    }
    return out
  }, testIds as string[])
}

/** Single-control convenience over {@link measureRow}. Never use two of these to
 *  compare positions BETWEEN controls — use one `measureRow` call. */
async function measureReach(scope: Locator, testId: string): Promise<Reach> {
  const m = (await measureRow(scope, [testId]))[testId]
  if (!m) throw new Error(`${testId} not found under the scoped element`)
  return m
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

      const rects = await measureRow(card, APPROVAL_CONTROLS)
      for (const id of APPROVAL_CONTROLS) {
        const m = rects[id]
        expect(m, `${id} must be present to be measured`).toBeTruthy()
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
      // ONE measurement pass at ONE scroll offset — comparing `top` across
      // separate scroll-then-measure calls would let scroll drift masquerade as
      // a wrap (or hide one).
      const rects = await measureRow(card, APPROVAL_CONTROLS)
      const tops = new Set(APPROVAL_CONTROLS.map(id => rects[id].top))
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

  const rects = await measureRow(card, APPROVAL_CONTROLS)
  // Assert PRESENCE on the measurements, not on the length of the id list we
  // just mapped over: a missing control yields `undefined`, and spreading that
  // would leave every geometry assertion below comparing `undefined` to
  // `undefined` — passing vacuously.
  for (const id of APPROVAL_CONTROLS) {
    expect(rects[id], `${id} must be present at desktop width to be measured`).toBeTruthy()
  }
  const measured = APPROVAL_CONTROLS.map(id => ({ id, ...rects[id] }))
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
  // tab order and reading order do not diverge. Asserted on the INLINE axis via
  // the document's direction rather than on raw `left`, so the invariant is not
  // secretly LTR-only (the house rule is direction-agnostic UI).
  const rtl = await card.evaluate(() => getComputedStyle(document.documentElement).direction === 'rtl')
  const inlineStarts = measured.map(m => (rtl ? -m.left : m.left))
  expect(
    inlineStarts,
    'controls must render in DOM order along the inline axis',
  ).toEqual([...inlineStarts].sort((a, b) => a - b))
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

    // The assertions above are necessary but, on their own, PAPER coverage for
    // this surface: Decline + Submit are ~146px of a ~238px row, so they fit on
    // one line and pass identically on the broken pre-fix markup. What actually
    // has to hold is that this footer CANNOT clip when it stops fitting — the
    // sibling's real risk: its no-fields variant pairs Decline with the much
    // longer "Accept without values". A `deep-chat-elicitation-no-fields` gallery
    // slug EXISTS, but it does not render that variant — measured at 390px it
    // yields `mcp-elicitation-no-fields-card` = 0 and `elicitation-accept-no-values`
    // = 0, because both elicitation slugs share one conversation id and the
    // message block's own content wins over the seeded composer entry. That is a
    // pre-existing gallery-fixture gap, not something to assert around. So stress
    // the real card instead: lengthen a label until the row must overflow, then
    // assert it wraps and stays reachable instead of clipping.
    // This exercises the CSS contract on the real surface rather than restating
    // the class list.
    const submit = card.getByTestId('elicitation-submit').first()
    await submit.evaluate(el => {
      el.textContent = 'Accept without values and continue this conversation'
    })
    const stressed = await measureRow(card, [
      'elicitation-decline',
      'elicitation-submit',
    ])
    for (const [id, m] of Object.entries(stressed)) {
      expect(
        m.visibleWidth,
        `under an over-wide label, ${id} is clipped (${m.visibleWidth}px visible of ${m.width}px)`,
      ).toBe(m.width)
    }
    expect(
      stressed['elicitation-decline'].top,
      'an over-wide action must WRAP onto its own line, not push its sibling out of the row',
    ).toBeLessThan(stressed['elicitation-submit'].top)
    await expectPressable(card, 'elicitation-decline', 'elicitation card, over-wide label')

    // …and the harder case the space-separated label above cannot reach: a single
    // UNBROKEN token (an ordinary German compound, or anything an MCP server
    // chooses). `whitespace-normal` only breaks at spaces, so this is what
    // separates a row that keeps its promise from one that silently spills its
    // label back out of the card's `overflow-hidden` edge.
    await submit.evaluate(el => {
      el.textContent = 'Akzeptierenohnewertefortsetzengenehmigungsanfrage'
    })
    const unbroken = await measureRow(card, ['elicitation-decline', 'elicitation-submit'])
    for (const [id, m] of Object.entries(unbroken)) {
      expect(
        m.visibleWidth,
        `under an unbroken over-long token, ${id} is clipped (${m.visibleWidth}px of ${m.width}px)`,
      ).toBe(m.width)
    }
    expect(
      await submit.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
      'an unbroken token must WRAP inside the control, not overflow it (whitespace-normal alone cannot do this)',
    ).toBe(true)
  })

  test(`TEST-6: the ask-user wizard's split footer keeps every action a PROTECTED direct child (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-ask-user-wizard', theme)
    const card = page.getByTestId('mcp-elicitation-pending-card').first()
    const row = card.locator('[data-slot="card-actions"]').first()

    // Every action must be a DIRECT child of the row. `CardActions`' protections
    // (`max-w-full`, wrapping labels) apply to direct children only, so grouping
    // the navigation buttons in a nested wrapper — the obvious way to build a
    // split row — would leave them with the kit Button's `shrink-0
    // whitespace-nowrap` and reproduce the original overflow-out-the-start-edge
    // defect inside the fix. This asserts the structure that makes the
    // protection reach them, which no reachability assertion can imply while the
    // current short labels happen to fit.
    const present = []
    for (const id of ['elicitation-decline', 'elicitation-back', 'elicitation-next', 'elicitation-submit']) {
      if ((await card.getByTestId(id).count()) > 0) present.push(id)
    }
    expect(present.length, 'the wizard footer must render controls to check').toBeGreaterThan(1)
    for (const id of present) {
      expect(
        await row.evaluate(
          (el, testId) => !!el.querySelector(`:scope > [data-testid="${testId}"]`),
          id,
        ),
        `${id} must be a DIRECT child of the action row, or the row's overflow protections do not reach it`,
      ).toBe(true)
    }

    // The split is expressed as `me-auto` on Decline inside the ordinary
    // `justify-end` row, NOT as `justify-between` on the row: `space-between`
    // puts a lone item on a wrapped line at main-START, so once the row wraps the
    // navigation group would jump to the inline-start edge while the sibling
    // approval cards stay inline-end aligned.
    expect(
      await row.evaluate(el => getComputedStyle(el).justifyContent),
      'the row must stay a justify-end row (the split comes from me-auto on Decline)',
    ).toBe('flex-end')
    // …and it genuinely splits: Decline sits at the inline-start of the row while
    // the navigation sits at the inline-end.
    const rects = await measureRow(card, present)
    const nav = present.filter(id => id !== 'elicitation-decline')
    for (const id of nav) {
      if (rects[id].top !== rects['elicitation-decline'].top) continue
      expect(
        rects[id].left,
        `${id} must sit after Decline on the shared line (the split layout)`,
      ).toBeGreaterThan(rects['elicitation-decline'].left)
    }

    for (const id of present) {
      expect(rects[id].visibleWidth, `${id} must not be clipped at 390px`).toBe(rects[id].width)
      await expectPressable(card, id, 'ask-user wizard at 390px')
    }

    // Stress the case the short default labels never reach: an over-wide action
    // must wrap and stay reachable, not protrude out of the unreachable edge.
    const stressTarget = nav[nav.length - 1]
    await card
      .getByTestId(stressTarget)
      .first()
      .evaluate(el => {
        el.textContent = 'Continue to the next question in this request'
      })
    const stressed = await measureRow(card, present)
    for (const id of present) {
      expect(
        stressed[id].visibleWidth,
        `under an over-wide nav label, ${id} is clipped (${stressed[id].visibleWidth}px of ${stressed[id].width}px)`,
      ).toBe(stressed[id].width)
    }
    await expectPressable(card, 'elicitation-decline', 'ask-user wizard, over-wide nav label')
  })
}

/* ── TEST-8 / TEST-10 — the DISCLOSURE half, scoped to what converged ────────
 *
 * These guard the defect this branch actually fixed on the header: at 390px the
 * two `whitespace-nowrap` secondary labels took 205px of a 238px row and starved
 * the tool NAME to a RENDERED WIDTH OF 0, so the card read
 * "(Acme Weather) — needs approval" with no indication of WHICH tool. Wrapping
 * the row fixed it.
 *
 * What these deliberately do NOT assert: that a LONG name is fully disclosed. A
 * name longer than the wrapped line still ellipsises. Three successive attempts
 * to fix that inside this branch each shipped a worse defect (unbounded growth;
 * then a clamp that cut ordinary names and whose "Show more" produced a 13,343px
 * card), and the audit profile stopped decaying — so that property is split out
 * rather than guarded by an assertion I could not make converge. Writing a test
 * for a property the code does not have is how the earlier versions of these two
 * tests came to pass on both fixed and broken code.
 */
for (const theme of THEMES) {
  test(`TEST-8: at 390px the approval card still shows WHICH tool is being approved (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-tool-approval', theme)
    const card = page.getByTestId('mcp-tool-approval-card').first()

    const name = card.getByText('get_forecast', { exact: true }).first()
    const m = await name.evaluate(el => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), scrollW: el.scrollWidth, title: el.getAttribute('title') }
    })
    // Asserted on RENDERED WIDTH, not text presence: the pre-existing TEST-11
    // asserts `toContainText('get_forecast')` and passed for the entire life of
    // the defect, because the string was there and simply unrenderable. That is
    // exactly how a consent surface shipped unable to say what it was asking
    // consent for.
    expect(
      m.w,
      `the tool name is rendered ${m.w}px wide (it needs ${m.scrollW}px) — the user cannot see which tool they are approving`,
    ).toBeGreaterThan(0)
    expect(
      m.w,
      `the tool name is cut (${m.w}px rendered of ${m.scrollW}px) at a width where it fits`,
    ).toBeGreaterThanOrEqual(m.scrollW - 1)
    await expect(name).toBeVisible()
    // The full name is at least available to a pointer user. Not a fix for the
    // touch case, and not claimed as one.
    expect(m.title, 'the full tool name must be available as a title').toBe('get_forecast')
  })

  test(`TEST-10: at 390px NO element of the identity row is starved by its siblings (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await openSurface(page, 'deep-chat-tool-approval', theme)
    const card = page.getByTestId('mcp-tool-approval-card').first()

    // The defect was a COMPETITION, not a property of any one element: three
    // labels shared a 238px row, two of them `whitespace-nowrap`, and whichever
    // lost rendered at zero width. Asserting only "the server label renders"
    // would pass on the broken markup too (there, the label wins and the NAME is
    // the one starved) — that is the vacuous-guard shape this spec keeps
    // catching. So assert the JOINT property: every element of the identity row
    // renders at its full intrinsic width, at the same time.
    const measured = await card.evaluate(root => {
      const texts = ['get_forecast', '(Acme Weather)', '— needs approval']
      const spans = [...root.querySelectorAll('span')]
      return texts.map(t => {
        const el = spans.find(sp => (sp.textContent || '').trim() === t)
        if (!el) return { text: t, found: false, w: 0, scrollW: 0 }
        return {
          text: t,
          found: true,
          w: Math.round(el.getBoundingClientRect().width),
          scrollW: el.scrollWidth,
        }
      })
    })
    for (const m of measured) {
      expect(m.found, `"${m.text}" must be present in the identity row`).toBe(true)
      expect(
        m.w,
        `"${m.text}" is rendered ${m.w}px wide of the ${m.scrollW}px it needs — a sibling starved it out of the row`,
      ).toBeGreaterThanOrEqual(m.scrollW - 1)
    }
  })
}

test('TEST-9: a NARROW CONTAINER at a WIDE viewport is protected too (the case a `sm:` breakpoint would miss)', async ({
  page,
}) => {
  // This is the case the primitive's design rationale rests on: a card's action
  // row lives in containers whose width is independent of the viewport (a split
  // pane, a side panel, an indented virtualized row). A viewport breakpoint
  // would report "wide" here and leave the row unwrapped — reintroducing the
  // defect — which is why the rule is content-driven. Every other test drives
  // the viewport, so without this one the motivating case is untested.
  await page.setViewportSize({ width: 1280, height: 900 })
  await openSurface(page, 'deep-chat-tool-approval', 'light')
  const card = page.getByTestId('mcp-tool-approval-card').first()

  // Squeeze the CARD, not the window.
  await card.evaluate(el => {
    ;(el as HTMLElement).style.width = '260px'
    ;(el as HTMLElement).style.maxWidth = '260px'
  })

  const rects = await measureRow(card, APPROVAL_CONTROLS)
  for (const id of APPROVAL_CONTROLS) {
    const m = rects[id]
    expect(
      m.visibleWidth,
      `${id} is clipped in a 260px-wide card at a 1280px viewport (${m.visibleWidth}px of ${m.width}px) — a viewport-driven rule would have missed this`,
    ).toBe(m.width)
  }
  expect(
    new Set(APPROVAL_CONTROLS.map(id => rects[id].top)).size,
    'the row must wrap on CONTAINER width, not viewport width',
  ).toBeGreaterThan(1)
  for (const id of APPROVAL_CONTROLS) {
    await expectPressable(card, id, 'narrow container at a wide viewport')
  }
})

test('TEST-7 (fixture precondition): the narrow surface really is too narrow for the controls, so the wrap path is genuinely exercised', async ({
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
    // The card now has TWO collapsibles — the identity line and the description
    // — so these must be scoped to the description's own block rather than
    // matching whichever comes first.
    const desc_block = card.getByTestId('approval-tool-description-collapsible')
    const toggle = desc_block.getByTestId('collapsible-toggle')
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
    const region = desc_block.getByTestId('collapsible-content')
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
    // The card now has TWO collapsibles — the identity line and the description
    // — so these must be scoped to the description's own block rather than
    // matching whichever comes first.
    const desc_block = card.getByTestId('approval-tool-description-collapsible')
    const toggle = desc_block.getByTestId('collapsible-toggle')

    const region = desc_block.getByTestId('collapsible-content')
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
