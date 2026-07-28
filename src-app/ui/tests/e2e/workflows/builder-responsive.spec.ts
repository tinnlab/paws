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
 *   - at 390px / 768px / 1280px the page never scrolls HORIZONTALLY
 *     (`scrollWidth <= clientWidth`) — a horizontal page scrollbar means some
 *     child is wider than the viewport, which is a layout bug at any width;
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

      // ── No horizontal page overflow ────────────────────────────────────────
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement
        return el.scrollWidth - el.clientWidth
      })
      expect(overflow, `horizontal page overflow ${at}`).toBeLessThanOrEqual(1)

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
  })
})
