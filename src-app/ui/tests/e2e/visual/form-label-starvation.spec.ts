/**
 * Layer A — FORM-LABEL STARVATION, over every gallery PAGE surface.
 *
 * This spec exists because of a specific miss: `/settings/scheduler` shipped
 * with every field label wrapping to one word per line beside a full-bleed
 * input, and EVERY gate was green. It was green because
 *
 *   • `tsc` / biome / `lint:settings-field` all passed (the control WAS inside a
 *     `Field` — the old lint only checked that much);
 *   • runtime-health saw no console error, no failed request, no contrast
 *     failure and no missing accessible name — the page rendered "fine";
 *   • Layer A (`layout.spec.ts`) iterates `gallery-section-*`, i.e. the KIT
 *     component stories — it has never asserted an invariant on ANY of the 46
 *     real page surfaces;
 *   • the 24/7 live-UI rig visits the page every cycle and has no category that
 *     can perceive a label wrapping INSIDE its allotted column.
 *
 * So this spec does the thing none of them did: it walks every gallery PAGE
 * surface (loaded state) at desktop AND mobile and measures label proportion.
 * See `tests/e2e/helpers/label-starvation.ts` for the definition and the
 * measured basis of the thresholds.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  collectStarvedLabels,
  describeStarvedLabel,
  isStarvedLabel,
  measureLabels,
  type LabelMetrics,
} from '../helpers/label-starvation'
import { STANDALONE_PATH } from './_gallery'

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

/** Enumerate the gallery's PAGE surfaces from the runtime manifest. */
async function pageSurfaces(page: Page): Promise<string[]> {
  await page.goto(STANDALONE_PATH, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('gallery-root').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(2000)
  return page.evaluate(() => {
    const w = window as unknown as {
      __GALLERY_LIST_ALL_SURFACES__?: () => { pages?: string[] }
      __GALLERY_OVERLAYS__?: string[]
      __GALLERY_DEEP_STATES__?: string[]
      __GALLERY_SEEDED__?: string[]
    }
    const fn = w.__GALLERY_LIST_ALL_SURFACES__
    if (typeof fn === 'function') return fn().pages ?? []
    const special = new Set([
      ...(w.__GALLERY_OVERLAYS__ ?? []),
      ...(w.__GALLERY_DEEP_STATES__ ?? []),
      ...(w.__GALLERY_SEEDED__ ?? []),
    ])
    return [
      ...new Set(
        Array.from(document.querySelectorAll('[data-testid^="gallery-page-"]'))
          .map(el => (el.getAttribute('data-testid') || '').replace('gallery-page-', ''))
          .filter(id => id && !special.has(id)),
      ),
    ]
  })
}

// ── the pure predicate (no browser) ───────────────────────────────────────────
// Fixtures are REAL measurements taken off the gallery, not invented numbers.
test.describe('isStarvedLabel — predicate', () => {
  const metric = (o: Partial<LabelMetrics>): LabelMetrics => ({
    text: 'Max active tasks per user',
    words: 5,
    chars: 25,
    lines: 5,
    boxW: 43,
    naturalW: 162,
    rowW: 840,
    selector: '#probe',
    ...o,
  })

  test('flags every measured Scheduler label (the reported defect)', () => {
    // as measured on gallery `settings-scheduler`, dark, loaded, 1280x900
    const measured: LabelMetrics[] = [
      metric({ text: 'Max active tasks per user', words: 5, chars: 25, lines: 5, boxW: 43, naturalW: 162 }),
      metric({ text: 'Minimum interval (seconds)', words: 3, chars: 26, lines: 3, boxW: 68, naturalW: 186 }),
      metric({ text: 'Self-paced loop horizon (days)', words: 4, chars: 30, lines: 5, boxW: 52, naturalW: 199 }),
      metric({ text: 'Auto-pause after N consecutive failures', words: 5, chars: 38, lines: 4, boxW: 84, naturalW: 264 }),
      metric({ text: 'Notification retention (days, 0 = forever)', words: 6, chars: 42, lines: 4, boxW: 80, naturalW: 272 }),
    ]
    for (const m of measured) expect(isStarvedLabel(m), m.text).toBe(true)
  })

  test('does not flag a label that simply has long text but uses its column', () => {
    // a 2-line label given ~90% of the width it needs — legitimate wrapping
    expect(isStarvedLabel(metric({ lines: 2, boxW: 190, naturalW: 210 }))).toBe(false)
  })

  test('does not flag a single-line label', () => {
    expect(isStarvedLabel(metric({ lines: 1, boxW: 208, naturalW: 208 }))).toBe(false)
  })

  test('does not flag a squeezed label in a genuinely narrow row (no slack)', () => {
    // 390px viewport, a dense drawer: the row itself is smaller than 2x the text
    expect(isStarvedLabel(metric({ lines: 3, boxW: 70, naturalW: 200, rowW: 340 }))).toBe(false)
  })

  test('does not flag one-word / icon-ish labels', () => {
    expect(isStarvedLabel(metric({ text: 'Name', words: 1, chars: 4, lines: 2, boxW: 10, naturalW: 40 }))).toBe(false)
    expect(isStarvedLabel(metric({ text: 'A b', words: 2, chars: 3, lines: 2, boxW: 5, naturalW: 20 }))).toBe(false)
  })
})

// ── detector acceptance: it must FIRE on a known-bad row ─────────────────────
test('detector acceptance — the pre-fix markup IS flagged, the correct markup is NOT', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(STANDALONE_PATH, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('gallery-root').waitFor({ state: 'visible', timeout: 30_000 })

  // Inject the EXACT shape of the shipped defect (label inside a flex-1
  // FieldContent, a w-full control as its sibling) next to a correctly-composed
  // row (label as a fixed-width direct child) in the same 840px container.
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'starvation-fixture'
    host.style.cssText = 'position:fixed;top:0;left:0;width:840px;z-index:99999;background:#111'
    host.innerHTML = `
      <div data-slot="field" data-orientation="horizontal" style="display:flex;flex-direction:row;align-items:flex-start;gap:8px;width:840px">
        <div data-slot="field-content" style="display:flex;flex:1 1 0%;flex-direction:column">
          <div data-slot="field-label" data-testid="fixture-bad-label" style="font:500 14px/1.4 sans-serif;width:fit-content">Auto pause after N consecutive failures</div>
        </div>
        <input style="width:100%;min-width:0;height:32px" value="5" />
      </div>
      <div data-slot="field" data-orientation="horizontal" style="display:flex;flex-direction:row;align-items:flex-start;gap:8px;width:840px">
        <label data-slot="field-label" data-testid="fixture-good-label" style="font:500 14px/1.4 sans-serif;width:13rem;flex:none">Auto pause after N consecutive failures</label>
        <div data-slot="field-content" style="display:flex;flex:1 1 0%;flex-direction:column">
          <input style="width:160px;height:32px" value="5" />
        </div>
      </div>`
    document.body.appendChild(host)
  })

  const all = await measureLabels(page)
  const bad = all.find(m => m.selector.includes('fixture-bad-label'))
  const good = all.find(m => m.selector.includes('fixture-good-label'))
  expect(bad, 'bad fixture label was measured').toBeTruthy()
  expect(good, 'good fixture label was measured').toBeTruthy()
  expect(isStarvedLabel(bad as LabelMetrics), describeStarvedLabel(bad as LabelMetrics)).toBe(true)
  expect(isStarvedLabel(good as LabelMetrics)).toBe(false)

  await page.evaluate(() => document.getElementById('starvation-fixture')?.remove())
})

// ── the sweep: every page surface, desktop + mobile ──────────────────────────
for (const vp of VIEWPORTS) {
  test(`no starved form labels on any gallery page — ${vp.name} (${vp.width}px)`, async ({
    page,
  }) => {
    test.slow() // ~46 surfaces x a full reload each
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const surfaces = await pageSurfaces(page)
    expect(surfaces.length, 'gallery should expose page surfaces').toBeGreaterThan(20)

    const failures: string[] = []
    for (const slug of surfaces) {
      await page.goto(`${STANDALONE_PATH}?surface=${slug}&state=loaded`, {
        waitUntil: 'domcontentloaded',
      })
      // Surfaces settle asynchronously (mock-API cassette + lazy stores).
      await page.waitForTimeout(1200)
      for (const m of await collectStarvedLabels(page)) {
        failures.push(`${slug} @ ${vp.name}: ${describeStarvedLabel(m)}`)
      }
    }

    expect(failures, `starved form labels:\n${failures.join('\n')}`).toEqual([])
  })
}
