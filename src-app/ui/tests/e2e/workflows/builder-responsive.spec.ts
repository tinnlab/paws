import type { Page } from '@playwright/test'
import { getAdminToken, loginAsAdmin } from '../../common/auth-helpers'
import { expect, test } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { addStep, openNewBuilder } from './helpers/builder-helpers'
import {
  MockBuilderToolsServer,
  SEARCH_PROPERTY_NAMES,
} from './helpers/builder-tools-mock-server'

/**
 * TEST-20 (ITEM-10) — the builder surface holds together across viewports.
 *
 * The owner reported this visually ("it doesn't fit on a narrow window"); this
 * spec is the machine-checkable part of that report:
 *
 *   - at 390px / 768px / 1280px nothing in the builder is wider than the space
 *     it is given — measured on the axis that can actually MOVE. NOTE:
 *     `document.scrollingElement.scrollWidth` is useless here: the builder
 *     renders inside `SettingsPage`'s `flex-1 overflow-hidden` and
 *     `SettingsPageContainer`'s `DivScrollY` (an OverlayScrollbars host), so the
 *     document never scrolls horizontally no matter how wide a child is — a
 *     900px step list at 390px would be CLIPPED and a document-level probe would
 *     still read 0. So the probe walks the builder's own ancestor chain (every
 *     clipping/scrolling box between the builder and the document) and each
 *     builder region, and fails on any horizontal scrollable overflow;
 *   - the Validation findings stay READABLE at every width — each finding is
 *     visible, has a real box, and its right edge is inside the viewport (a
 *     finding clipped off-screen is the ITEM-3 fix silently undone at 390px);
 *   - the tool step's GENERATED argument fields stack in ONE column at 390px —
 *     a two-up field grid at phone width is what makes the form unusable.
 *
 * The workflow under test deliberately holds BOTH a fully-configured tool step
 * (so the generated form is on screen) and an unconfigured agent step (so the
 * validation panel actually has findings to clip).
 *
 * No API mocking of ziee: a REAL MCP server is registered over the REST API,
 * pointing at an in-process mock MCP server on loopback, so the tool catalog
 * genuinely loads and the generated form is the real one.
 */

/** Sub-pixel tolerance for geometry comparisons (layout jitter, zoom rounding). */
const TOLERANCE = 1.5

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
] as const

/** Let the browser finish layout after a viewport change before measuring. */
async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/** The builder regions whose own width must never exceed the box they are in. */
const BUILDER_REGIONS = [
  'wf-builder-step-list',
  'wf-builder-step-config',
  'wf-builder-validation',
] as const

/**
 * The largest horizontal overflow this spec tolerates, in px — now pure
 * sub-pixel jitter slack, with NO defect allowance folded into it.
 *
 * It used to be 4. When this probe was rewritten to measure the axis that can
 * actually move, the first thing it found was a KIT defect: the combobox's
 * `InputGroup` inline-end addon rendered ~4px past its own group, because the
 * addon variant carried `has-[>button]:mr-[-0.3rem]` and a negative margin on a
 * flex child puts its border box outside the container's content box. That was
 * in the kit, not in this feature's files, so it was carried here as a bounded,
 * named allowance and reported onward.
 *
 * It has since been fixed at the source — `sdk/packages/kit/src/shadcn/
 * input-group.tsx` now uses grid-aligned logical padding
 * (`pe-2 has-[>button]:pe-1`) instead of a negative margin — so the allowance is
 * discharged and the constant returns to 1. The kit property itself is guarded
 * directly by `tests/e2e/visual/input-group-overflow.spec.ts` (backend-free,
 * 390px + 1280px, with a falsifiability control), which is what stops the
 * defect coming back without this full-stack spec having to tolerate it again.
 */
const MAX_TOLERATED_OVERFLOW_PX = 1

interface OverflowHit {
  where: string
  scrollWidth: number
  clientWidth: number
  over: number
}

/**
 * Every horizontal scrollable overflow the builder is responsible for.
 *
 * Two families, both measured on boxes that CAN move:
 *  - the ancestor chain from the builder up to `<html>` — an over-wide builder
 *    child grows the scrollWidth of whichever box clips or scrolls it (that is
 *    true for `overflow: hidden` too: the scrollable overflow region is still
 *    reported), which is exactly the signal the document-level probe cannot see;
 *  - each builder region itself.
 */
async function horizontalOverflow(
  page: Page,
  regions: readonly string[],
): Promise<OverflowHit[]> {
  return page.evaluate(
    ({ regionIds, tolerance }) => {
      const hits: {
        where: string
        scrollWidth: number
        clientWidth: number
        over: number
      }[] = []
      const label = (el: Element) => {
        const testid = el.getAttribute('data-testid')
        if (testid) return `[data-testid="${testid}"]`
        const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 4).join('.')
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
      }
      const record = (el: Element, where: string) => {
        const over = el.scrollWidth - el.clientWidth
        if (over > tolerance) {
          hits.push({
            where,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            over,
          })
        }
      }

      const anchor = document.querySelector('[data-testid="wf-builder-validation"]')
      if (!anchor) return [{ where: 'builder not rendered', scrollWidth: 0, clientWidth: 0, over: 0 }]

      // The chain that carries (or clips) the builder's width.
      for (
        let el: Element | null = anchor;
        el && el !== document.documentElement;
        el = el.parentElement
      ) {
        record(el, `ancestor ${label(el)}`)
      }
      record(document.documentElement, 'ancestor <html>')

      for (const id of regionIds) {
        const el = document.querySelector(`[data-testid="${id}"]`)
        if (el) record(el, `region [data-testid="${id}"]`)
      }
      return hits
    },
    { regionIds: [...regions], tolerance: MAX_TOLERATED_OVERFLOW_PX },
  )
}

test.describe('Workflows — builder responsive layout', () => {
  let mock: MockBuilderToolsServer

  test.beforeEach(async () => {
    mock = await MockBuilderToolsServer.start()
  })

  test.afterEach(async () => {
    await mock?.dispose()
  })

  test('TEST-20: no horizontal overflow at 390/768/1280px, findings stay readable, and the generated tool fields stack in one column at 390px', async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const srvName = `e2e_resp_srv_${Date.now()}`

    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    const srvResp = await request.post(`${apiURL}/api/mcp/servers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: srvName,
        display_name: 'E2E Responsive Tool Server',
        enabled: true,
        transport_type: 'http',
        url: mock.url(),
        timeout_seconds: 30,
      },
    })
    expect(srvResp.status(), `seed mcp server: ${await srvResp.text()}`).toBe(
      201,
    )

    await openNewBuilder(page, baseURL)

    // An UNCONFIGURED agent step: it is what makes the validation panel report
    // findings, so "findings stay readable" has something real to measure.
    await addStep(page, 'agent', 1)

    // A CONFIGURED tool step, added second so it is the selected step and its
    // generated argument form is the one on screen.
    await addStep(page, 'tool', 1)
    await byTestId(page, 'wf-builder-tool-server').click()
    await byTestId(page, `wf-builder-tool-server-opt-${srvName}`).click()

    // The catalog loads for real → the Tool control is the picker. Choose the
    // schema-rich tool so the generated form has several fields to stack.
    const toolField = byTestId(page, 'wf-builder-tool-name')
    await expect(byTestId(page, 'wf-builder-tool-catalog-error')).toHaveCount(
      0,
      {
        timeout: 20000,
      },
    )
    await toolField.click()
    const searchOption = byTestId(page, 'wf-builder-tool-name-opt-search')
    await expect(searchOption).toBeVisible({ timeout: 20000 })
    await searchOption.click()
    await expect(byTestId(page, 'wf-builder-tool-args-generated')).toBeVisible({
      timeout: 15000,
    })

    // The validation feed must actually have findings, or the clipping check
    // below would pass vacuously.
    await expect(byTestId(page, 'wf-builder-finding').first()).toBeVisible({
      timeout: 20000,
    })

    for (const viewport of VIEWPORTS) {
      const at = `at ${viewport.width}px`
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await settleLayout(page)

      // The builder is still rendered (a viewport change must not blank it).
      await expect(byTestId(page, 'wf-builder-page-title'), at).toBeVisible()
      await expect(byTestId(page, 'wf-builder-validation'), at).toBeVisible()

      // ── No horizontal overflow anywhere the builder can cause one ─────────
      const hits = await horizontalOverflow(page, BUILDER_REGIONS)
      expect(
        hits,
        `horizontal overflow ${at}: ${JSON.stringify(hits, null, 2)}`,
      ).toEqual([])

      // The document itself must not scroll horizontally either. (Kept for the
      // case where the shell's clipping is ever removed — on its own it is NOT
      // a sufficient probe; see the header note.)
      const pageOverflow = await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement
        return el.scrollWidth - el.clientWidth
      })
      expect(pageOverflow, `horizontal page overflow ${at}`).toBeLessThanOrEqual(1)

      // ── Findings stay readable (not clipped) ──────────────────────────────
      const findings = byTestId(page, 'wf-builder-finding')
      const findingCount = await findings.count()
      expect(
        findingCount,
        `validation findings rendered ${at}`,
      ).toBeGreaterThan(0)
      for (let i = 0; i < findingCount; i++) {
        const finding = findings.nth(i)
        await expect(finding, `finding ${i} visible ${at}`).toBeVisible()
        const box = await finding.boundingBox()
        expect(box, `finding ${i} has a box ${at}`).not.toBeNull()
        if (!box) continue
        expect(box.width, `finding ${i} width ${at}`).toBeGreaterThan(0)
        expect(box.height, `finding ${i} height ${at}`).toBeGreaterThan(0)
        expect(
          box.x,
          `finding ${i} starts inside the viewport ${at}`,
        ).toBeGreaterThanOrEqual(-TOLERANCE)
        expect(
          box.x + box.width,
          `finding ${i} ends inside the viewport ${at}`,
        ).toBeLessThanOrEqual(viewport.width + TOLERANCE)
        // Its text is genuinely on screen, not collapsed to a sliver.
        const text = (await finding.innerText()).trim()
        expect(text.length, `finding ${i} has copy ${at}`).toBeGreaterThan(0)
      }

      // ── One column at phone width ─────────────────────────────────────────
      if (viewport.width === 390) {
        const boxes: { name: string; x: number; y: number; bottom: number }[] =
          []
        for (const name of SEARCH_PROPERTY_NAMES) {
          const field = byTestId(page, `wf-builder-tool-arg-field-${name}`)
          await expect(
            field,
            `generated field ${name} visible ${at}`,
          ).toBeVisible()
          const box = await field.boundingBox()
          expect(box, `generated field ${name} has a box ${at}`).not.toBeNull()
          if (!box) continue
          boxes.push({
            name,
            x: box.x,
            y: box.y,
            bottom: box.y + box.height,
          })
          // Each generated control also fits the viewport.
          expect(
            box.x + box.width,
            `generated field ${name} ends inside the viewport ${at}`,
          ).toBeLessThanOrEqual(viewport.width + TOLERANCE)
        }
        expect(boxes.length, `generated fields measured ${at}`).toBe(
          SEARCH_PROPERTY_NAMES.length,
        )

        // ONE column = every field shares the same start edge …
        const firstX = boxes[0].x
        for (const b of boxes) {
          expect(
            Math.abs(b.x - firstX),
            `generated field ${b.name} shares the column start edge ${at}`,
          ).toBeLessThanOrEqual(TOLERANCE)
        }
        // … and no two of them sit side-by-side (each begins below the one
        // before it, which a 2-up grid would violate).
        const ordered = [...boxes].sort((a, b) => a.y - b.y)
        for (let i = 1; i < ordered.length; i++) {
          expect(
            ordered[i].y,
            `generated field ${ordered[i].name} stacks below ${ordered[i - 1].name} ${at}`,
          ).toBeGreaterThanOrEqual(ordered[i - 1].bottom - TOLERANCE)
        }
      }
    }

    // ── INV-2 at phone width: a finding TAKES you to its step ───────────────
    // The validation panel sits at the bottom of the page and the layout stacks
    // below `md`, so at 390px the selected step's configuration is below the
    // fold: selecting alone leaves the click with no visible effect.
    await page.setViewportSize({ width: 390, height: 844 })
    await settleLayout(page)

    const config = byTestId(page, 'wf-builder-step-config')
    const goto = page.locator('[data-testid^="wf-builder-finding-goto-"]').first()
    await expect(goto, 'a finding offers a goto affordance at 390px').toBeVisible()
    // Put the findings on screen — which is what pushes the config panel out of
    // view, i.e. the situation the author is actually in when they read one.
    await goto.scrollIntoViewIfNeeded()
    await settleLayout(page)

    // "In view" = the START of the configuration is on screen. A panel whose top
    // edge is above the viewport is one the author was dropped into the middle
    // of — not "taken to".
    const startOnScreen = async () => {
      const box = await config.boundingBox()
      if (!box) return false
      return box.y >= -TOLERANCE && box.y < 844
    }
    expect(
      await startOnScreen(),
      'precondition: with the findings on screen the step configuration must be scrolled off at 390px',
    ).toBe(false)

    await goto.click()
    await settleLayout(page)
    await expect
      .poll(startOnScreen, {
        message:
          'clicking a finding selected the step but left its configuration off-screen — ' +
          'at 390px the click had no visible effect (INV-2)',
        timeout: 5000,
      })
      .toBe(true)
  })
})
