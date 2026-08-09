/**
 * collapse-border-overlay (issue #183) — bordered cards inside a COLLAPSED long
 * assistant turn had their borders washed out, and crisp again once expanded.
 *
 * NOTE ON THE SUBJECT (changed 2026-08): the original cards were the Thinking and
 * tool-call boxes. The ACTIVITY RAIL replaced both with timeline ROWS — by design
 * (`RailStepDetail`: "No nested disclosure") — so this spec ran against a surface
 * with zero `[data-slot="card"]` and went red on main with `Expected: >= 3 /
 * Received: 0` for eleven days. The fixture now uses resolved `elicitation_request`
 * blocks, which are rail BREAKOUTS and therefore still render the extension's full
 * kit <Card> (same `ring-1 ring-foreground/10`) inline inside the clamp. The
 * invariant under test is unchanged; only the content type carrying it moved.
 * Do NOT re-point this at the rail's own buttons: they use a real CSS `border`
 * painted INSIDE the border box, so they survive a border-box clip and would pin
 * nothing.
 *
 * Root cause (measured — see .lifecycle/collapse-border-overlay/REPRO.md): a kit
 * `<Card>`'s border is `ring-1`, a box-shadow with 1px SPREAD and no offset, so
 * it is painted ENTIRELY OUTSIDE the element's border box. While clamped,
 * `CollapsibleBlock` applies BOTH `overflow-hidden` AND a `mask-image`, and each
 * clips to the border box independently (`mask-clip` defaults to `border-box`).
 * With the card flush against that container, 100% of its ring fell in the
 * clipped zone. Isolation measurements confirmed either property ALONE was
 * sufficient to erase it, so neither "drop the mask" nor "soften the ramp" would
 * have fixed it. The fix is a 2px inset on the clamped container that gives the
 * ring room inside both clips.
 *
 * These specs assert the EFFECT, not the mechanism: for every card inside the
 * clamp, its border box must sit at least 1px inside the clipping edge, which is
 * exactly the condition under which a 1px-spread ring survives. Asserting the
 * inset's classes instead (`padding === '2px'`) would freeze the technique — any
 * equivalent re-implementation (a wrapper element, a `mask-clip` override) would
 * fail spuriously while the surface stayed correct, and such a test would not
 * have caught the original bug at all.
 *
 * Why geometry rather than pixels: the container has no border, so its overflow
 * clip edge (padding box) and its mask clip edge (border box) coincide with its
 * client rect — making "card is >=1px inside that rect" a precise, deterministic
 * statement of ring survival. The pixel-level proof that this condition really
 * does correspond to a visible ring (deltas 0 -> 25 light / 0 -> 23 dark, both
 * states, before and after) is recorded in
 * .lifecycle/collapse-border-overlay/REPRO.md. `toHaveScreenshot` is not used
 * because Layer B baselines are gitignored (`.gitignore:36`) and cannot ride the
 * PR as a durable guarantee.
 */
import { expect, test, type Page } from '@playwright/test'
import { STANDALONE_PATH, THEMES } from './_gallery'

const SURFACE = 'deep-chat-collapsed-tool-boxes'

/**
 * The kit Card's border is `ring-1` — a box-shadow with 1px SPREAD and no
 * offset, painted 1px OUTSIDE the card's own border box. So the card must sit at
 * least this far inside the clamped container's clip edge for the ring to
 * survive. At 0 (the bug) the entire ring fell outside and vanished.
 */
const RING_SPREAD_PX = 1

/**
 * Where the bottom-fade mask starts, as a fraction of the clamp height —
 * `linear-gradient(to bottom, black 75%, transparent)`. Below this point content
 * is deliberately faded, so pixel assertions there would measure the fade rather
 * than the fix.
 */
const RAMP_FRACTION = 0.75

/**
 * Minimum gap between the topmost card and the viewport top before the paint
 * probes can run. `isEdgePainted` samples a strip 8px OUTSIDE a card's edge and
 * throws (deliberately — fail closed) if that strip would fall off-screen, so the
 * surface must be positioned with room to spare, not merely "scrolled".
 */
const SAMPLE_MARGIN_PX = 24

/**
 * How many bordered cards the fixture puts inside the clamp. Kept in lockstep with
 * `chat-deep.ts`'s `collapsedToolBoxes`; the assertions below want "at least 3",
 * but the readiness wait wants the EXACT end state, because "at least 3" is
 * satisfied the moment the third of five has mounted.
 */
const EXPECTED_IN_CLAMP_CARDS = 3

/** How long the turn's viewport position must hold still to count as settled. */
const SCROLL_QUIET_MS = 250

/**
 * Block until the assistant turn's viewport position has STOPPED changing.
 *
 * Strictly read-only. The list mounts pinned to the bottom and performs a late
 * auto-scroll, so a measurement taken too early is measuring a moving target —
 * and `isEdgePainted` is measure-then-screenshot, so a scroll landing between
 * those two steps makes it sample bare background at stale coordinates and report
 * `LEFT border is not painted`, i.e. an issue-183 alarm for a defect that is not
 * there. That race was always latent behind `waitForTimeout(350)`; a taller turn
 * merely made it likely enough to see.
 *
 * (An earlier attempt polled AND nudged the scroller in the same predicate. Don't:
 * a predicate that mutates what it measures fights whatever else is scrolling and
 * never converges — it turned four passing tests into 60s timeouts.)
 */
async function waitForScrollQuiet(page: Page): Promise<void> {
  await page.waitForFunction(
    ms => {
      const msg = document
        .querySelector('[data-testid="collapsible-content"]')
        ?.closest('[data-testid="chat-message"]')
      if (!msg) return false
      const top = msg.getBoundingClientRect().top
      const w = window as unknown as { __clpProbe?: { top: number; since: number } }
      const now = performance.now()
      if (!w.__clpProbe || Math.abs(w.__clpProbe.top - top) > 0.5) {
        w.__clpProbe = { top, since: now }
        return false
      }
      return now - w.__clpProbe.since >= ms
    },
    SCROLL_QUIET_MS,
    { polling: 50 },
  )
}

/**
 * Put the assistant turn where the paint probes can sample it: settled, then
 * positioned ONCE, then settled again, then verified.
 *
 * `isEdgePainted` samples a strip 8px OUTSIDE a card's edge and throws (fail
 * closed) if that strip would fall off-screen, so `scrollIntoView({block:'start'})`
 * — which parks the turn's top edge exactly AT the viewport top — leaves the first
 * card with nothing above it to sample. Backing off by `SAMPLE_MARGIN_PX` is what
 * gives the probe room.
 */
async function settleForSampling(page: Page): Promise<void> {
  let cardTop = Number.NaN
  // A BOUNDED RETRY, not a polling predicate that mutates: each attempt waits for
  // the surface to stop moving, positions it once, waits again, then MEASURES.
  // Under parallel load a single attempt can lose to a reflow that lands right
  // after the scroll (a lazily-imported extension mounting a block changes the
  // turn's height), so re-running the whole settle is the honest repair. Trying
  // to correct inside the wait predicate is what previously never converged.
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForScrollQuiet(page)
    await page.evaluate(margin => {
      const msg = document
        .querySelector('[data-testid="collapsible-content"]')
        ?.closest('[data-testid="chat-message"]')
      if (!msg) return
      msg.scrollIntoView({ block: 'start' })
      const deficit = margin - msg.getBoundingClientRect().top
      if (deficit <= 0) return
      // `hidden` is excluded on purpose: the clamped container itself is
      // `overflow-hidden` with content taller than its box, and treating that
      // shape as "a scroller" picks an element whose scrollTop moves nothing.
      let el: Element | null = msg.parentElement
      while (el) {
        const s = getComputedStyle(el)
        if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(s.overflowY)) {
          el.scrollTop -= deficit
          return
        }
        el = el.parentElement
      }
      window.scrollBy(0, -deficit)
    }, SAMPLE_MARGIN_PX)
    await waitForScrollQuiet(page)

    cardTop = await page.evaluate(() => {
      const msg = document
        .querySelector('[data-testid="collapsible-content"]')
        ?.closest('[data-testid="chat-message"]')
      const cards = [...(msg?.querySelectorAll('[data-slot="card"]') ?? [])]
      return cards.length
        ? Math.min(...cards.map(c => c.getBoundingClientRect().top))
        : Number.NaN
    })
    if (cardTop >= 8) return
  }
  expect(
    cardTop,
    'the turn could not be positioned with room above its topmost card after 5 ' +
      'attempts, so the paint probes would sample off-screen — this is a ' +
      'harness/positioning failure, NOT issue #183',
  ).toBeGreaterThanOrEqual(8)
}

async function openSurface(page: Page, theme: string): Promise<void> {
  const q = new URLSearchParams({ surface: SURFACE, theme, accent: 'blue' })
  await page.goto(`${STANDALONE_PATH}?${q.toString()}`)
  await page.getByTestId('collapsible-content').first().waitFor({ state: 'visible' })
  await page.waitForFunction(t => document.documentElement.classList.contains(t), theme)
  await page.evaluate(() => document.fonts?.ready)
  // WAIT FOR THE CARDS THEMSELVES, not just for the clamp to exist.
  //
  // A content block renders only once its extension's renderer is registered, and
  // that registration is asynchronous — so `collapsible-content` becomes visible
  // while the message still holds ZERO cards, and the turn is briefly shorter than
  // it will end up. Measuring in that window produced the whole spread of flakes
  // seen while rebuilding this fixture: `Received: 0` cards, a turn that had not
  // yet grown past the clamp threshold (`collapsed` still false), and stale
  // coordinates that made a painted ring look unpainted. One deterministic wait on
  // the real end state removes all three.
  //
  // The timeout is deliberately far above the 10s `expect` default: the cards come
  // from the mcp extension's renderer, which is registered by a lazily-imported
  // module, and this suite runs `fullyParallel` — 30 browsers hitting one Vite dev
  // server, on a shared box. Under that load the module import alone can outlast
  // 10s. This is a READINESS wait on the end state, not a latency budget; nothing
  // about the invariant is weakened by allowing the page longer to finish booting.
  await expect(
    page.locator('[data-testid="chat-message"][data-role="assistant"] [data-slot="card"]'),
    'the fixture is built to put exactly this many bordered cards inside the clamp',
  ).toHaveCount(EXPECTED_IN_CLAMP_CARDS, { timeout: 30_000 })
  // Scroll the assistant turn to the top of the viewport: the list is pinned to
  // the bottom, and the paint checks screenshot real pixels, which requires the
  // cards to be on screen.
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid="collapsible-content"]')
    c?.closest('[data-testid="chat-message"]')?.scrollIntoView({ block: 'start' })
  })
  await settleForSampling(page)
}

interface CardBox {
  /** Position among the message's `[data-slot="card"]` elements, in DOM order.
   *  It is the handle `isEdgePainted` uses to RE-MEASURE the card immediately
   *  before screenshotting it, instead of trusting the rect captured earlier. */
  index: number
  testid: string | null
  x: number
  y: number
  w: number
  h: number
  insideClamp: boolean
  topRelClamp: number
  bottomRelClamp: number
  /**
   * Tightest gap between the card's border box and EVERY clipping ancestor, per
   * side. Taking the minimum across all clippers — not just the nearest — is
   * what makes removing the bubble's `px-0.5` detectable: while collapsed the
   * nearest clipper is the clamped container itself (it carries
   * `overflow-hidden`), whose own padding would report a comfortable 2px no
   * matter what an ancestor does.
   *
   * `roomBottom` is deliberately NOT asserted: the clamp's bottom edge IS the
   * fold, so a card bisected by it legitimately has its lower edge cut.
   */
  roomLeft: number
  roomRight: number
  roomTop: number
  roomBottom: number
  tightestX: string | null
  tightestY: string | null
}

interface Turn {
  clampHeight: number
  collapsed: string | null
  maskImage: string
  overflow: string
  clampContentWidth: number
  parentContentWidth: number
  cards: CardBox[]
  order: string[]
}

/**
 * Geometry of the clamp + every bordered card, SCOPED to the assistant turn on
 * this surface. Scoped rather than a bare `document.querySelector` so that if
 * the fixture ever gains an earlier clamping message this keeps measuring the
 * turn under test instead of silently measuring an unrelated one.
 */
async function readTurn(page: Page): Promise<Turn> {
  return page.evaluate(() => {
    const msg = [...document.querySelectorAll('[data-testid="chat-message"]')].find(
      m =>
        m.getAttribute('data-role') === 'assistant' &&
        m.querySelector('[data-testid="collapsible-content"]'),
    )
    if (!msg) throw new Error('no clamping assistant turn on this surface')
    const content = msg.querySelector('[data-testid="collapsible-content"]')!
    const cr = content.getBoundingClientRect()
    const cs = getComputedStyle(content)
    // Every ancestor WITHIN THIS MESSAGE that clips on either axis, or carries a
    // mask (mask-clip defaults to border-box, so a mask clips too).
    //
    // The walk stops at the message root on purpose: above it sits the message
    // list's scroll container, whose clipping is a scroll boundary rather than a
    // rendering defect — a card near the top of the viewport legitimately has
    // ~0px of room against it, which would otherwise raise a false #183 alarm.
    //
    // Clipping is tracked PER AXIS. The bubble's clip layer is
    // `overflow-x: clip` with `overflow-y: visible` — it constrains the sides but
    // not the top, so measuring a vertical gap against it would report 0 for a
    // card it does not vertically clip at all.
    const allClippers = (from: Element): { el: Element; x: boolean; y: boolean }[] => {
      const out: { el: Element; x: boolean; y: boolean }[] = []
      let el: Element | null = from.parentElement
      while (el && el !== msg.parentElement && el !== document.documentElement) {
        const s = getComputedStyle(el)
        const clips = (v: string) => v !== 'visible' && v !== ''
        // A mask clips on BOTH axes (mask-clip defaults to border-box).
        const masked = (s.maskImage || s.webkitMaskImage || 'none') !== 'none'
        const x = clips(s.overflowX) || masked
        const y = clips(s.overflowY) || masked
        if (x || y) out.push({ el, x, y })
        el = el.parentElement
      }
      return out
    }
    const cards = [...msg.querySelectorAll('[data-slot="card"]')].map((el, index) => {
      const r = el.getBoundingClientRect()
      const clippers = allClippers(el)
      // Tightest gap across ALL clippers, so an ancestor that stops absorbing
      // the inset is caught even while a nearer one reports plenty of room.
      let roomLeft = Infinity
      let roomRight = Infinity
      let roomTop = Infinity
      let roomBottom = Infinity
      // Named per axis: a single `tightest` would let the y-branch overwrite the
      // x-branch's winner and point a debugger at the wrong element.
      let tightestX: Element | null = null
      let tightestY: Element | null = null
      for (const k of clippers) {
        const kr = k.el.getBoundingClientRect()
        // An overflow clip cuts at the PADDING box, so discount any border the
        // ancestor carries. getBoundingClientRect is the border box; clientLeft /
        // clientTop are exactly those border widths.
        const bl = k.el.clientLeft
        const bt = k.el.clientTop
        if (k.x) {
          const l = r.left - (kr.left + bl)
          const rt = kr.right - bl - r.right
          if (Math.min(l, rt) < Math.min(roomLeft, roomRight)) tightestX = k.el
          roomLeft = Math.min(roomLeft, l)
          roomRight = Math.min(roomRight, rt)
        }
        if (k.y) {
          const t = r.top - (kr.top + bt)
          if (t < roomTop) tightestY = k.el
          roomTop = Math.min(roomTop, t)
          roomBottom = Math.min(roomBottom, kr.bottom - bt - r.bottom)
        }
      }
      const label = (e: Element | null) =>
        e?.getAttribute('data-testid') ?? e?.tagName.toLowerCase() ?? null
      return {
        index,
        testid: el.getAttribute('data-testid'),
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        insideClamp: content.contains(el),
        topRelClamp: Math.round(r.top - cr.top),
        bottomRelClamp: Math.round(r.bottom - cr.top),
        roomLeft: +roomLeft.toFixed(2),
        roomRight: +roomRight.toFixed(2),
        roomTop: +roomTop.toFixed(2),
        roomBottom: +roomBottom.toFixed(2),
        tightestX: label(tightestX),
        tightestY: label(tightestY),
      }
    })
    // Rendered block order INCLUDING prose, so a card/text reorder is
    // detectable — an order list of cards alone could not catch one.
    const blocks = [...(content.firstElementChild?.children ?? [])]
    const order = blocks.map(el =>
      el.matches('[data-slot="card"]') || el.querySelector('[data-slot="card"]')
        ? 'card'
        : 'text',
    )
    // Content-box widths, to prove the inset self-cancels: the clamped
    // container's usable width must equal its parent's, i.e. the negative margin
    // and the padding really do offset.
    const px = (v: string) => parseFloat(v) || 0
    const parent = content.parentElement!
    const ps = getComputedStyle(parent)
    return {
      clampHeight: cr.height,
      collapsed: content.getAttribute('data-collapsed'),
      maskImage: cs.maskImage || cs.webkitMaskImage,
      overflow: cs.overflow,
      clampContentWidth: +(cr.width - px(cs.paddingLeft) - px(cs.paddingRight)).toFixed(2),
      parentContentWidth: +(
        parent.getBoundingClientRect().width -
        px(ps.paddingLeft) -
        px(ps.paddingRight)
      ).toFixed(2),
      cards,
      order,
    }
  })
}

/**
 * Assert every card inside the clamp has room for its ring on ALL FOUR sides,
 * measured against the real clipping ancestor.
 */
function expectRingRoom(cards: CardBox[]): void {
  const inside = cards.filter(c => c.insideClamp)
  // Guard: an empty set would satisfy the loop below and prove nothing.
  expect(inside.length, 'no cards inside the clamp to check').toBeGreaterThanOrEqual(3)
  // Left/right/top only. `roomBottom` is intentionally excluded: the clamp's
  // bottom edge IS the fold, so a card bisected by it legitimately has its lower
  // edge cut, and asserting it would raise a false "#183" alarm on ordinary
  // fixture drift (one extra line of narration pushes the last card across 384px).
  const sides = [
    ['roomLeft', 'LEFT', 'tightestX'],
    ['roomRight', 'RIGHT', 'tightestX'],
    ['roomTop', 'TOP', 'tightestY'],
  ] as const
  for (const c of inside) {
    for (const [key, label, clipperKey] of sides) {
      expect(
        c[key],
        `${c.testid}: only ${c[key]}px between the card and its tightest ` +
          `${label}-clipping ancestor (${c[clipperKey]}) — its 1px ring is clipped ` +
          `there. This is issue #183.`,
      ).toBeGreaterThanOrEqual(RING_SPREAD_PX)
    }
  }
}

/**
 * Is the card's border actually PAINTED on the given side?
 *
 * Room for a ring is necessary but not sufficient — a `ring-0` on the kit Card
 * would leave the geometry untouched while erasing every border. So compare a
 * thin strip straddling the card's edge against an identically-sized strip of
 * bare background just outside it: if the two screenshots are byte-identical,
 * nothing is drawn at the edge.
 *
 * Buffers are compared directly rather than decoded — two PNGs of identical
 * pixel data encode identically, which is all this needs and avoids adding an
 * image-decoding dependency.
 */
async function isEdgePainted(page: Page, c: CardBox, side: 'left' | 'top'): Promise<boolean> {
  // RE-MEASURE, don't trust the caller's rect.
  //
  // This function is measure-then-screenshot, and the geometry the caller holds
  // was read at `readTurn` time — possibly several awaits ago. Anything that
  // scrolls or reflows in between (a late list re-anchor, a font swap, a lazily
  // registered extension mounting a block) leaves those coordinates pointing at
  // background, both strips come back identical, and the result is a confident
  // `LEFT border is not painted while collapsed (issue #183)` for a ring that is
  // there. Observed exactly that way under parallel load. Waiting for the surface
  // to hold still and then re-reading the card is what makes the sample and the
  // measurement describe the same instant.
  const measure = async () => {
    await waitForScrollQuiet(page)
    return page.evaluate(index => {
      const msg = document
        .querySelector('[data-testid="collapsible-content"]')
        ?.closest('[data-testid="chat-message"]')
      const el = msg?.querySelectorAll('[data-slot="card"]')[index]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, c.index)
  }
  let fresh = await measure()
  // Quiet means "not moving NOW", which is also true of a surface that already
  // scrolled somewhere useless — and the list does drift between the left-edge
  // samples and the top-edge one. So RE-POSITION when the fresh rect is out of
  // reach rather than reporting a positioning problem as a missing border. The
  // fail-closed throw below still stands if repositioning does not help; this
  // only removes the case where it would have.
  if (fresh && fresh.y < SAMPLE_MARGIN_PX / 2) {
    await settleForSampling(page)
    fresh = await measure()
  }
  if (!fresh) {
    throw new Error(
      `card #${c.index} (${c.testid}) is no longer in the DOM at sampling time`,
    )
  }
  // NOTE: for a viewport screenshot Playwright's `clip` is in VIEWPORT
  // coordinates, the same space getBoundingClientRect reports — do NOT add
  // window.scrollX/Y here. (Doing so silently samples background and reports
  // every border as missing.)
  const midY = Math.round(fresh.y + fresh.h / 2)
  const midX = Math.round(fresh.x + fresh.w / 2)
  // Cover ONLY the 1px ring (painted just outside the border box) plus 1px of
  // background beside it — deliberately NOT the card's interior. Including the
  // interior would make this pass on any theme where `bg-card` differs from the
  // page background, ring or no ring (observed: a `ring-0` regression slipped
  // through in dark mode with a wider window).
  const edge =
    side === 'left'
      ? { x: Math.round(fresh.x) - 2, y: midY, width: 2, height: 1 }
      : { x: midX, y: Math.round(fresh.y) - 2, width: 1, height: 2 }
  // Same size, shifted further OUT of the card into bare background.
  const bare = side === 'left' ? { ...edge, x: edge.x - 6 } : { ...edge, y: edge.y - 6 }
  // Fail CLOSED. Returning `true` here would silently vacate the assertion the
  // moment the surface shifted within ~8px of the viewport edge — exactly the
  // condition openSurface's scrollIntoView({block:'start'}) pushes toward.
  if (edge.x < 0 || edge.y < 0 || bare.x < 0 || bare.y < 0) {
    throw new Error(
      `cannot sample the ${side} edge of ${c.testid}: it sits within 8px of the ` +
        `viewport edge (card at ${Math.round(fresh.x)},${Math.round(fresh.y)}). ` +
        `Scroll the surface further into view rather than letting this check pass ` +
        `vacuously.`,
    )
  }
  const [a, b] = [await page.screenshot({ clip: edge }), await page.screenshot({ clip: bare })]
  return !a.equals(b)
}

test.describe('chat collapse — card borders (issue #183)', () => {
  test('TEST-2: the surface reproduces the bug preconditions', async ({ page }) => {
    await openSurface(page, 'light')
    const turn = await readTurn(page)

    // It genuinely clamps — otherwise neither the mask nor the overflow clip is
    // applied and every ring assertion below would be vacuous.
    expect(turn.collapsed).toBe('true')
    expect(turn.overflow).toBe('hidden')
    expect(turn.maskImage).not.toBe('none')
    expect(turn.clampHeight).toBeLessThanOrEqual(400)

    // The bordered cards are INSIDE the clamped region — the exact configuration
    // that erased their rings. If a future change hoists them out, this fails
    // loudly rather than letting the ring assertions pass for the wrong reason.
    const inside = turn.cards.filter(c => c.insideClamp)
    expect(inside.length).toBeGreaterThanOrEqual(3)

    // A card sits ENTIRELY above the mask ramp (75% of the clamp) and another
    // reaches past it, so the surface covers the ramp as well as the hard clip.
    // Asserted on `bottomRelClamp` for both: `topRelClamp < ramp` would be a
    // tautology, since the first card is always at ~0.
    const ramp = turn.clampHeight * 0.75
    expect(inside.some(c => c.bottomRelClamp < ramp)).toBe(true)
    expect(inside.some(c => c.bottomRelClamp > ramp)).toBe(true)

    // A card also sits NEAR the TOP of the clamp — the position whose top
    // hairline a horizontal-only inset left clipped.
    //
    // The bound was 4px while the first card was a Thinking card (`mb-2`, so a
    // bottom margin only) and its top sat FLUSH at the clamp's 2px inset. Since
    // the activity rail took that card over, the first in-clamp card is an
    // elicitation breakout, whose wrapper carries `my-2` — 8px above as well.
    // 12 is that measured position (2px clamp inset + 8px wrapper margin) plus
    // rounding headroom; it is NOT a threshold loosened until the test passed.
    //
    // Be honest about what that costs: with 8px of its own margin, this card's
    // top hairline survives even with the vertical half of the inset reverted,
    // so the TOP edge is no longer the load-bearing half of this pin. The
    // LEFT/RIGHT edges still are, tightly — every card measures exactly 2px of
    // room there, i.e. the inset and nothing else (see CTRL-1, which reverts the
    // inset and requires this spec to go red). Restoring a genuinely flush-top
    // subject needs an inline card type without a top margin; none exists on an
    // assistant turn today.
    expect(Math.min(...inside.map(c => c.topRelClamp))).toBeLessThanOrEqual(12)

    // Interleaved order preserved, prose INCLUDED: the fixture is
    // card → text → card → text → card → text, so cards and prose must
    // genuinely alternate rather than prose merely trailing the cards.
    expect(turn.order.filter(k => k === 'card').length).toBeGreaterThanOrEqual(3)
    expect(turn.order.slice(0, 6)).toEqual([
      'card',
      'text',
      'card',
      'text',
      'card',
      'text',
    ])
  })

  for (const theme of THEMES) {
    test(`TEST-3: every card's ring renders while COLLAPSED (${theme})`, async ({
      page,
    }) => {
      await openSurface(page, theme)
      const turn = await readTurn(page)
      expect(turn.collapsed).toBe('true')

      // Both clips (overflow + mask) are ACTIVE here, so this is the state that
      // erased the rings.
      expect(turn.overflow).toBe('hidden')
      expect(turn.maskImage).not.toBe('none')

      // (a) geometry — the ring has room inside the real clipping ancestor.
      expectRingRoom(turn.cards)

      // (b) paint — the ring is actually DRAWN. Geometry alone would still pass
      // if the kit Card dropped to `ring-0`, so assert both. Checked on the LEFT
      // edge of every card and on the TOP edge of the first one, which is the
      // position a horizontal-only inset left clipped.
      //
      // Restricted to cards sampled ABOVE the mask ramp, for the same reason
      // expectRingRoom skips the bottom edge: the ramp deliberately fades
      // everything below 75% of the clamp toward transparent, so a card that
      // drifts into it has a legitimately faint ring and one pushed past the fold
      // samples clipped background on both strips. Either would report "not
      // painted" and blame issue #183 for benign fixture drift.
      const rampTop = turn.clampHeight * RAMP_FRACTION
      const inside = turn.cards.filter(
        c => c.insideClamp && c.topRelClamp + c.h / 2 < rampTop,
      )
      expect(
        inside.length,
        'no cards sit above the mask ramp — the paint checks would prove nothing',
      ).toBeGreaterThanOrEqual(2)
      for (const c of inside) {
        expect(
          await isEdgePainted(page, c, 'left'),
          `${c.testid}: LEFT border is not painted while collapsed (issue #183)`,
        ).toBe(true)
      }
      const first = inside.reduce((a, b) => (a.topRelClamp <= b.topRelClamp ? a : b))
      expect(
        await isEdgePainted(page, first, 'top'),
        `${first.testid}: TOP border is not painted while collapsed — the card ` +
          `flush with the clamp's top edge still has its hairline clipped`,
      ).toBe(true)
    })
  }

  test('TEST-4: the inset self-cancels — usable width is unchanged', async ({ page }) => {
    await openSurface(page, 'light')
    const collapsed = await readTurn(page)

    // The whole reason the inset is safe is that the negative margin and the
    // padding offset exactly, so content is laid out in the same width as
    // before. Asserting THAT catches the realistic mistake — writing `p-0.5`
    // without `-m-0.5`, which would silently narrow every clamped message by
    // 4px and reflow its text.
    //
    // (Note this is the meaningful check here, NOT comparing card widths across
    // collapsed/expanded: because the inset self-cancels, those widths are equal
    // whether it is applied unconditionally or gated on isClamped, so such a
    // comparison could not distinguish the two.)
    expect(collapsed.clampContentWidth).toBeCloseTo(collapsed.parentContentWidth, 1)

    await page.getByTestId('collapsible-toggle').click()
    await expect(page.getByTestId('collapsible-toggle')).toHaveText(/Show less/i)
    const expanded = await readTurn(page)
    expect(expanded.clampContentWidth).toBeCloseTo(expanded.parentContentWidth, 1)

    // And the cards genuinely occupy the same width in both states.
    expect(expanded.cards.map(c => Math.round(c.w))).toEqual(
      collapsed.cards.map(c => Math.round(c.w)),
    )
  })

  test('TEST-5: collapse still bounds the message height', async ({ page }) => {
    await openSurface(page, 'light')
    const turn = await readTurn(page)
    // Height-bounding is the feature's whole purpose; the border fix must not
    // trade it away. The clamp holds the WHOLE bubble, cards included.
    expect(turn.collapsed).toBe('true')
    expect(turn.clampHeight).toBeLessThanOrEqual(400)
    await expect(page.getByTestId('collapsible-toggle')).toHaveText(/Show more/i)
  })

  for (const theme of THEMES) {
    test(`TEST-8: expanded is unclamped and still crisp (${theme})`, async ({ page }) => {
      await openSurface(page, theme)
      await page.getByTestId('collapsible-toggle').click()
      await expect(page.getByTestId('collapsible-toggle')).toHaveText(/Show less/i)
      // Expanding grows the turn and the bottom-pinned list re-anchors, which can
      // carry the cards back off the top of the viewport — re-settle before the
      // paint probes below sample real pixels.
      await settleForSampling(page)

      const turn = await readTurn(page)
      // Expanded is the CONTROL — it always rendered correctly, so the point is
      // that the collapsed state now MATCHES it, not that the defect moved.
      expect(turn.collapsed).toBe('false')
      expect(turn.maskImage).toBe('none')
      expect(turn.overflow).not.toBe('hidden')
      expect(turn.clampHeight).toBeGreaterThan(400)

      // Assert PAINT, not room: with no mask and no clip there is nothing to be
      // clipped by, so a ring-room assertion here would be vacuous.
      const inside = turn.cards.filter(c => c.insideClamp)
      expect(inside.length).toBeGreaterThanOrEqual(3)
      for (const c of inside) {
        expect(
          await isEdgePainted(page, c, 'left'),
          `${c.testid}: LEFT border is not painted when expanded`,
        ).toBe(true)
      }
    })
  }
})
