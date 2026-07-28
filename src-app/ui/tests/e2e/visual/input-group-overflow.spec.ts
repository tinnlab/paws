/**
 * Layer A — the kit `InputGroup` addon must sit INSIDE its group.
 *
 * This spec exists because of a specific miss. `builder-responsive.spec.ts` was
 * rewritten to probe the axis that can actually move, and the first thing it
 * found was a KIT defect: at 390px the combobox's inline-end addon rendered past
 * its own group. Nothing could fail on that — so the builder spec carried it as
 * a documented `MAX_TOLERATED_OVERFLOW_PX = 4` allowance and reported it
 * onward. A tolerance constant is not a guard: it keeps the defect green
 * forever, and it lives in a spec about the workflow builder rather than about
 * the component that is actually wrong.
 *
 * Cause (fixed in `sdk/packages/kit/src/shadcn/input-group.tsx`): the addon's
 * `inline-end` variant carried `has-[>button]:mr-[-0.3rem]`. In a flex row a
 * negative `margin-right` on the last item shrinks its OUTER size, so its border
 * box ends |margin| past the container's content box — measured at 3.8px past
 * the group, on every combobox, at every width. That forces a horizontal
 * scrollbar on any `overflow-auto` ancestor and poisons every ancestor-chain
 * overflow probe downstream.
 *
 * So this spec asserts the property directly, on the component itself, over the
 * whole backend-free gallery: no `input-group` scrolls horizontally, and no
 * inline-end addon extends past its group's border box. It runs at 390px (the
 * width the residual named) AND at 1280px, because the cause was never a
 * breakpoint effect and a 390-only probe would let a width-independent
 * regression back in.
 */
import { expect, test } from '@playwright/test'
import { STANDALONE_PATH } from './_gallery'

/** Sub-pixel slack for layout jitter / zoom rounding. NOT a defect allowance. */
const JITTER_PX = 1

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
] as const

interface GroupProbe {
  /** How the group is identified in a failure message. */
  where: string
  /** `scrollWidth - clientWidth` on the group itself. */
  overflow: number
  /** How far the inline-end addon's right edge sits past the group's. */
  addonPastEnd: number | null
}

/**
 * Measure every `[data-slot="input-group"]` currently rendered.
 *
 * Two independent signals, so a fix that merely hides the symptom cannot pass:
 * the group's own scrollable overflow, and the geometric relationship between
 * the inline-end addon and the group's border box (measured in the writing
 * direction, so the assertion is RTL-correct).
 */
async function probeGroups(page: import('@playwright/test').Page): Promise<GroupProbe[]> {
  return page.evaluate(() => {
    const out: {
      where: string
      overflow: number
      addonPastEnd: number | null
    }[] = []
    for (const el of Array.from(
      document.querySelectorAll('[data-slot="input-group"]'),
    )) {
      const labelled = el.closest('[data-testid]')?.getAttribute('data-testid')
      const groupBox = el.getBoundingClientRect()
      const rtl = getComputedStyle(el).direction === 'rtl'
      const addon = el.querySelector(
        '[data-slot="input-group-addon"][data-align="inline-end"]',
      )
      let addonPastEnd: number | null = null
      if (addon) {
        const a = addon.getBoundingClientRect()
        // "past the inline END" — the right edge in LTR, the left edge in RTL.
        addonPastEnd = rtl ? groupBox.left - a.left : a.right - groupBox.right
      }
      out.push({
        where: labelled ? `[data-testid="${labelled}"]` : 'input-group',
        overflow: el.scrollWidth - el.clientWidth,
        addonPastEnd: addonPastEnd === null ? null : Number(addonPastEnd.toFixed(2)),
      })
    }
    return out
  })
}

test.describe('kit — InputGroup addon containment', () => {
  for (const vp of VIEWPORTS) {
    test(`TEST-7: no input-group overflows its box at ${vp.width}px (${vp.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(STANDALONE_PATH, { waitUntil: 'domcontentloaded' })
      await page
        .getByTestId('gallery-root')
        .waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(1500)

      const groups = await probeGroups(page)

      // The gallery must actually be rendering the component under test, or
      // every assertion below would pass vacuously.
      expect(
        groups.length,
        `the gallery rendered no [data-slot="input-group"] at ${vp.width}px — this spec would prove nothing`,
      ).toBeGreaterThan(0)

      const scrolling = groups.filter(g => g.overflow > JITTER_PX)
      expect(
        scrolling,
        `input-group(s) with horizontal scrollable overflow at ${vp.width}px: ${JSON.stringify(scrolling, null, 2)}`,
      ).toEqual([])

      const bleeding = groups.filter(
        g => g.addonPastEnd !== null && g.addonPastEnd > JITTER_PX,
      )
      expect(
        bleeding,
        `inline-end addon(s) rendering past their group's border box at ${vp.width}px: ${JSON.stringify(bleeding, null, 2)}`,
      ).toEqual([])

      // At least one group must actually CARRY an inline-end addon, otherwise
      // the containment assertion above is measuring nothing.
      expect(
        groups.filter(g => g.addonPastEnd !== null).length,
        `no input-group carried an inline-end addon at ${vp.width}px`,
      ).toBeGreaterThan(0)
    })
  }

  /**
   * Falsifiability control. The assertions above are absence-shaped, so this
   * re-injects the exact defect that was fixed (a negative inline-end margin on
   * the addon) and confirms the probe turns red. Without this, a probe that
   * silently stopped finding anything would still be "green".
   */
  test('TEST-7 control: the probe fails when the negative inline-end margin is re-injected', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(STANDALONE_PATH, { waitUntil: 'domcontentloaded' })
    await page
      .getByTestId('gallery-root')
      .waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(1500)

    await page.addStyleTag({
      content:
        '[data-slot="input-group-addon"][data-align="inline-end"]{margin-inline-end:-0.3rem}',
    })
    await page.waitForTimeout(200)

    const groups = await probeGroups(page)
    expect(
      groups.some(g => g.overflow > JITTER_PX),
      'with a -0.3rem inline-end margin injected, the overflow probe must go red',
    ).toBe(true)
    expect(
      groups.some(g => g.addonPastEnd !== null && g.addonPastEnd > JITTER_PX),
      'with a -0.3rem inline-end margin injected, the containment probe must go red',
    ).toBe(true)
  })
})
