import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  BUILTIN_SERVER,
  openSeededConversation,
  railIn,
  seedRailConversation,
  textBlock,
  toolPair,
} from './helpers/rail-helpers'

/**
 * TEST-8 [acceptance, INV-8] — 390px.
 *
 * INV-8: "At 390px the step label truncates and never wraps."
 *
 * A wrapping label is what turns a thin timeline back into a stack of blocks:
 * two-line rows double the rail's height, break the icon/label alignment the
 * spine depends on, and re-introduce exactly the visual weight the feature
 * removes. So this asserts computed GEOMETRY, not visibility — a label that
 * wrapped would still be `toBeVisible()`.
 *
 * Tool names are deliberately long so `scrollWidth > clientWidth` is a real
 * measurement at 390px rather than an accident of a short label; mcp's generic
 * contribution title-cases the raw id, so the label length is under the spec's
 * control without any extension knowing about this test.
 *
 * 390 is the iPhone-14 viewport; 768 and 1280 are checked too so a fix that only
 * worked at one breakpoint cannot pass.
 */

const LONG_TOOL_A =
  'run_the_extremely_long_named_diagnostic_sweep_across_every_configured_upstream_endpoint'
const LONG_TOOL_B =
  'reconcile_the_entire_document_index_against_the_remote_manifest_and_report_drift'
const LONG_TOOL_C =
  'summarise_every_open_incident_across_all_regions_grouped_by_severity_and_owner'

/** One line box, measured — the CSS `truncate` contract. */
async function labelGeometry(page: Page) {
  return page.$$eval('[data-testid="rail-step-label"]', els =>
    els.map(el => {
      const cs = getComputedStyle(el)
      const rects = el.getClientRects()
      return {
        text: (el.textContent ?? '').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        lineBoxes: rects.length,
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight) || 0,
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
      }
    }),
  )
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

test.describe('Activity rail — 390px label truncation (INV-8)', () => {
  test('every step label is single-line and truncated at 390px, and the page never scrolls horizontally', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-390', [
      { role: 'user', blocks: [textBlock('Run the full diagnostic pass.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_narrow_a',
            name: LONG_TOOL_A,
            serverId: BUILTIN_SERVER.codeSandbox,
            input: { scope: 'all' },
            result: 'Swept 14 endpoints, all healthy.',
          }),
          ...toolPair({
            id: 'toolu_narrow_b',
            name: LONG_TOOL_B,
            serverId: BUILTIN_SERVER.files,
            input: { manifest: 'remote' },
            result: 'No drift detected.',
          }),
          ...toolPair({
            id: 'toolu_narrow_c',
            name: LONG_TOOL_C,
            serverId: BUILTIN_SERVER.codeSandbox,
            input: { group_by: 'severity' },
            result: '3 open incidents.',
          }),
          textBlock('Everything is healthy; three incidents remain open.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]

    // ── 390px — the invariant's own width ──────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 })
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 20000 })

    // The collapsed summary is itself a single line at 390.
    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).toBeVisible()
    expect(await summary.evaluate(el => el.getClientRects().length)).toBe(1)

    await summary.click()
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()
    await expect(rail.getByTestId('rail-step')).toHaveCount(3)

    const rows = await labelGeometry(page)
    expect(rows.length, 'all three step labels must be measured').toBe(3)
    for (const r of rows) {
      // NEVER WRAPS: exactly one line box, and the box is one line tall.
      expect(r.lineBoxes, `"${r.text}" must occupy exactly one line box`).toBe(1)
      if (r.lineHeight > 0) {
        expect(
          r.height,
          `"${r.text}" is taller than one line — it wrapped`,
        ).toBeLessThanOrEqual(r.lineHeight * 1.5)
      }
      // TRUNCATES: the text genuinely overflows its box and is ellipsised.
      expect(
        r.scrollWidth,
        `"${r.text}" must overflow its box at 390px for truncation to be under test`,
      ).toBeGreaterThan(r.clientWidth)
      expect(r.whiteSpace).toBe('nowrap')
      expect(r.textOverflow).toBe('ellipsis')
    }

    // The page body never scrolls horizontally.
    const overflow390 = await pageOverflow(page)
    expect(
      overflow390.scrollWidth,
      'the rail must not push the document wider than the viewport at 390px',
    ).toBeLessThanOrEqual(overflow390.clientWidth)

    // The row's own affordances are still usable at 390 — exercise, don't just
    // look. (The detail suffix is deliberately hidden below `sm`; the label,
    // the disclosure and the record button are not.)
    const firstStep = rail.getByTestId('rail-step').first()
    const toggle = firstStep.getByTestId('rail-step-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(firstStep.getByTestId('rail-step-body')).toBeVisible()
    await expect(firstStep.getByTestId('rail-step-record-btn')).toBeVisible()
    // Expanding a body must not introduce horizontal page scroll either.
    const afterExpand = await pageOverflow(page)
    expect(afterExpand.scrollWidth).toBeLessThanOrEqual(afterExpand.clientWidth)

    // ── 768 and 1280 — the same contract at the other breakpoints ──────────
    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(rail.getByTestId('rail-step')).toHaveCount(3)
      const wider = await labelGeometry(page)
      for (const r of wider) {
        expect(r.lineBoxes, `"${r.text}" wrapped at ${width}px`).toBe(1)
        expect(r.whiteSpace).toBe('nowrap')
      }
      const overflow = await pageOverflow(page)
      expect(
        overflow.scrollWidth,
        `the document scrolls horizontally at ${width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth)
    }
  })
})
