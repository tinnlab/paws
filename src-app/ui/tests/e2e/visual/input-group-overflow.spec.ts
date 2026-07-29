/**
 * Layer A — the kit `InputGroup` addon must sit INSIDE its group.
 *
 * This spec exists because of a specific miss. `builder-responsive.spec.ts` was
 * rewritten to probe the axis that can actually move, and the first thing it
 * found was a KIT defect: the combobox's inline-end addon rendered past its own
 * group. Nothing could fail on that — so the builder spec carried it as a
 * documented `MAX_TOLERATED_OVERFLOW_PX = 4` allowance and reported it onward.
 * A tolerance constant is not a guard: it keeps the defect green forever, and it
 * lives in a spec about the workflow builder rather than about the component
 * that is actually wrong.
 *
 * Cause (fixed in `sdk/packages/kit/src/shadcn/input-group.tsx`): the addon's
 * inline variants carried a CONDITIONAL negative inline margin, applied only when
 * the addon has a direct `button` (or `kbd`) child. A negative inline margin on a
 * flex child shrinks its OUTER size, so its border box ends |margin| past the
 * container's content box — measured at 3.8px past the group, on every combobox,
 * at every width. That forces a horizontal scrollbar on any `overflow-auto`
 * ancestor and poisons every ancestor-chain overflow probe downstream.
 *
 * So this spec asserts the property directly, on the component itself:
 *
 *  - at 390px (the width the residual named) AND 1280px, because the cause was
 *    never a breakpoint effect and a 390-only probe would let a width-independent
 *    regression back in;
 *  - for BOTH `inline-start` and `inline-end` addons, measured in the WRITING
 *    direction — the two variants are written as a symmetric pair, so a guard on
 *    one of them lets the other rot;
 *  - in LTR **and RTL**, because the fix's whole rationale was replacing physical
 *    margins with logical padding, and only an RTL render can show whether that
 *    actually holds;
 *  - with a falsifiability control that re-injects the ORIGINAL conditional
 *    selector (`:has(> button)`), not a blanket margin — a control that injects a
 *    stronger defect than the one that existed does not prove the probe would
 *    catch a real revert.
 *
 * WHAT THIS SPEC DOES NOT COVER, stated so the gap is not rediscovered as a
 * surprise: the gallery renders only `inline-end` addons carrying a `> button`
 * (a combobox trigger) plus `command`'s `inline-start` icon addon. It therefore
 * exercises the `has-[>button]` branch and the bare branch, but NOT the
 * `has-[>kbd]` branch, and not an `inline-start` addon with a button child —
 * because no consumer in this tree renders one. The probe is written over both
 * aligns so those cells are measured the moment such a consumer appears, rather
 * than needing the spec to be rewritten first.
 */
import { expect, test, type Page } from '@playwright/test'
import { STANDALONE_PATH } from './_gallery'

/** Sub-pixel slack for layout jitter / zoom rounding. NOT a defect allowance. */
const JITTER_PX = 1

/** The exact rule that was removed, re-injectable for the control. */
const REVERTED_RULE =
  '[data-slot="input-group-addon"][data-align="inline-end"]:has(> button)' +
  '{margin-inline-end:-0.3rem}'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
] as const

const DIRECTIONS = ['ltr', 'rtl'] as const

interface GroupProbe {
  /** How the group is identified in a failure message. */
  where: string
  /** Which addon this row measures. */
  align: 'inline-start' | 'inline-end'
  /** `scrollWidth - clientWidth` on the group itself. */
  overflow: number
  /** How far the addon's edge sits past the group's, in the writing direction. */
  addonPastEdge: number
  /** Whether this addon carries the `> button` child the reverted rule keyed on. */
  hasButtonChild: boolean
  /**
   * The control's inline padding on the ADDON's side minus its padding on the
   * opposite side, in the WRITING direction.
   *
   * `InputGroup` TIGHTENS the control's padding on whichever side the addon is
   * on (the addon's own padding already supplies the visual gap), and it selects
   * that side from the LOGICAL `data-align`. It used to APPLY the tightening
   * physically, which was invisible while the addon's own padding was physical
   * too — so converting the addon left RTL tightening the side with NO addon on
   * it. Measured: −4 (10px base, 6px tightened) in BOTH directions when correct;
   * +4 in RTL when the rule is physical. So the invariant is "strictly
   * negative", identically in either direction — which is a thing only an RTL
   * render can falsify.
   */
  controlClearanceDelta: number | null
}

/**
 * Measure every inline addon of every `[data-slot="input-group"]` on the page.
 *
 * Two independent signals, so a fix that merely hides the symptom cannot pass:
 * the group's own scrollable overflow, and the geometric relationship between the
 * addon and the group's border box. The geometry is measured per align and in the
 * writing direction, so the assertion is meaningful under RTL rather than
 * accidentally inverted.
 */
async function probeGroups(page: Page): Promise<GroupProbe[]> {
  return page.evaluate(() => {
    const out: {
      where: string
      align: 'inline-start' | 'inline-end'
      overflow: number
      addonPastEdge: number
      hasButtonChild: boolean
      controlClearanceDelta: number | null
    }[] = []
    for (const el of Array.from(
      document.querySelectorAll('[data-slot="input-group"]'),
    )) {
      const labelled = el.closest('[data-testid]')?.getAttribute('data-testid')
      const groupBox = el.getBoundingClientRect()
      const rtl = getComputedStyle(el).direction === 'rtl'
      const overflow = el.scrollWidth - el.clientWidth
      for (const align of ['inline-start', 'inline-end'] as const) {
        const addon = el.querySelector(
          `[data-slot="input-group-addon"][data-align="${align}"]`,
        )
        if (!addon) continue
        const a = addon.getBoundingClientRect()
        // Distance the addon protrudes beyond the group on ITS OWN side, with
        // the physical side chosen by the writing direction.
        const startSide = rtl ? groupBox.right - a.right : a.left - groupBox.left
        const endSide = rtl ? groupBox.left - a.left : a.right - groupBox.right
        const control = el.querySelector('[data-slot="input-group-control"]')
        let controlClearanceDelta: number | null = null
        if (control) {
          const cs = getComputedStyle(control)
          const padStart = Number.parseFloat(rtl ? cs.paddingRight : cs.paddingLeft)
          const padEnd = Number.parseFloat(rtl ? cs.paddingLeft : cs.paddingRight)
          const onAddonSide = align === 'inline-end' ? padEnd : padStart
          const onOtherSide = align === 'inline-end' ? padStart : padEnd
          controlClearanceDelta = Number((onAddonSide - onOtherSide).toFixed(2))
        }
        out.push({
          where: labelled ? `[data-testid="${labelled}"]` : 'input-group',
          align,
          overflow,
          addonPastEdge: Number(
            (align === 'inline-end' ? endSide : -startSide).toFixed(2),
          ),
          hasButtonChild: !!addon.querySelector(':scope > button'),
          controlClearanceDelta,
        })
      }
    }
    return out
  })
}

/**
 * Open the gallery and wait for the component under test to actually be in the
 * DOM — not for a fixed timeout. The gallery's page surfaces are `React.lazy`
 * over a shared dev server, so a wall-clock settle silently under-measures on a
 * slow load while the two vacuity guards below would still be satisfied by the
 * eagerly-rendered kit stories.
 */
async function openWithAddons(page: Page, dir: string) {
  await page.goto(`${STANDALONE_PATH}?theme=light&accent=blue&dir=${dir}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.getByTestId('gallery-root').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll('[data-slot="input-group-addon"][data-align]'),
      ).some(a => !!a.querySelector(':scope > button')),
    undefined,
    { timeout: 30_000 },
  )
}

test.describe('kit — InputGroup addon containment', () => {
  for (const dir of DIRECTIONS) {
    for (const vp of VIEWPORTS) {
      test(`TEST-7: no input-group overflows its box at ${vp.width}px (${vp.name}, ${dir})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await openWithAddons(page, dir)

        const groups = await probeGroups(page)
        const at = `${vp.width}px/${dir}`

        // The gallery must be rendering the component under test, or every
        // assertion below would pass vacuously.
        expect(
          groups.length,
          `no [data-slot="input-group"] carried an inline addon at ${at} — this spec would prove nothing`,
        ).toBeGreaterThan(0)

        // …and specifically the shape the reverted rule keyed on. An addon with
        // no button child could never have overflowed, so counting those would
        // let the probe "pass" against a configuration that was never broken.
        expect(
          groups.filter(g => g.hasButtonChild).length,
          `no addon with a direct > button child at ${at} — the reverted rule only applied to those, so the probe must measure at least one`,
        ).toBeGreaterThan(0)

        const scrolling = groups.filter(g => g.overflow > JITTER_PX)
        expect(
          scrolling,
          `input-group(s) with horizontal scrollable overflow at ${at}: ${JSON.stringify(scrolling, null, 2)}`,
        ).toEqual([])

        const bleeding = groups.filter(g => g.addonPastEdge > JITTER_PX)
        expect(
          bleeding,
          `addon(s) rendering past their group's border box at ${at}: ${JSON.stringify(bleeding, null, 2)}`,
        ).toEqual([])

        // The control's padding must be TIGHTENED on the addon's side. This is
        // the part an RTL render is uniquely able to observe: the group picks
        // the side from the logical `data-align`, so applying it physically is
        // invisible in LTR and lands on the wrong side in RTL. Without this the
        // RTL rows would merely re-assert the LTR overflow property and could
        // not fail on their own.
        const misplaced = groups.filter(
          g => g.controlClearanceDelta !== null && g.controlClearanceDelta >= 0,
        )
        expect(
          misplaced,
          `the control's padding is NOT tightened on the addon's side at ${at} (physical padding keyed off a logical attribute): ${JSON.stringify(misplaced, null, 2)}`,
        ).toEqual([])
        expect(
          groups.filter(g => g.controlClearanceDelta !== null).length,
          `no group paired an addon with a control at ${at} — the clearance assertion measured nothing`,
        ).toBeGreaterThan(0)
      })
    }
  }

  /**
   * Falsifiability control. The assertions above are absence-shaped, so this
   * re-injects the EXACT rule that was removed — conditional on a `> button`
   * child, exactly as the kit had it — and confirms the probe turns red. Without
   * this, a probe that silently stopped finding anything would still be "green";
   * and with a blanket margin instead of the conditional one it would only prove
   * the probe catches a defect nobody shipped.
   */
  test('TEST-7 control: the probe fails when the reverted rule is re-injected', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWithAddons(page, 'ltr')

    const clean = await probeGroups(page)
    expect(
      clean.filter(g => g.overflow > JITTER_PX),
      'precondition: the page must be clean before the defect is injected',
    ).toEqual([])

    await page.addStyleTag({ content: REVERTED_RULE })
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-slot="input-group"]')).some(
          el => el.scrollWidth - el.clientWidth > 1,
        ),
      undefined,
      { timeout: 5_000 },
    )

    const groups = await probeGroups(page)
    expect(
      groups.some(g => g.overflow > JITTER_PX),
      'with the reverted conditional margin injected, the overflow probe must go red',
    ).toBe(true)
    expect(
      groups.some(g => g.align === 'inline-end' && g.addonPastEdge > JITTER_PX),
      'with the reverted conditional margin injected, the containment probe must go red',
    ).toBe(true)
  })
})
