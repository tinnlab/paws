import { expect, test } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * TEST-1/2/3/4 — the sidebar notification bell popover stays inside its panel
 * and inside the viewport, at every width, with MANY notifications.
 *
 * The user reported: *"the render of the notification popover is also broken,
 * not responsive"*. Measured on `origin/main` with 11 seeded rows, the popover
 * PANEL was the kit's fixed `w-72` (288px) while the bell's content wrapper
 * carried an inline `style={{ width: 340 }}`:
 *
 *   | viewport | panel clientWidth | panel scrollWidth | doc clientWidth | doc scrollWidth |
 *   |----------|-------------------|-------------------|-----------------|-----------------|
 *   | 1440×900 | 288               | 350               | 1440            | 1440            |
 *   |  390×844 | 288               | 350               |  390            |  390            |
 *   |  320×700 | 288               | 350               |  320            | *358*           |
 *
 * i.e. 62px of every row (the mark-read + delete controls) painted OUTSIDE the
 * popover's background, and at 320px the page body scrolled sideways.
 *
 * ## Why these assertions and not `toBeVisible()`
 *
 * Visibility is exactly what did NOT catch this: every control was "visible" —
 * just drawn on top of the chat composer instead of inside the panel. So each
 * assertion below is GEOMETRIC and is the mechanical form of a design invariant:
 *
 *  - INV-1 → `documentElement.scrollWidth === clientWidth` (no sideways body scroll)
 *  - INV-2 → the same containment holds at 320 / 390 / 1440, not just desktop
 *  - INV-4 → panel `scrollWidth === clientWidth`, and every interactive control's
 *            rect is horizontally inside the panel's rect
 *
 * Notifications are server-emitted (there is no create API), so rows are seeded
 * straight into the per-test DB via `sql()` — mirroring
 * `15-notifications/background-inbox.spec.ts` — and the real REST endpoint then
 * serves them. No `page.route` mocking: this drives the real backend end-to-end.
 */

/** More than the bell's 8-row slice, so the list genuinely overflows its cap. */
const SEED_COUNT = 12

/** The two shapes that actually broke the layout. */
const LONG_TITLE =
  'Quarterly cross-institutional pharmacogenomics variant reconciliation sweep has completed successfully'
const UNBROKEN_TOKEN =
  'pmid:PMC10293847_supplementary_table_S3_reconciliation_output_final_v2_reviewed.csv'

interface PopoverMetrics {
  panel: { left: number; right: number; top: number; bottom: number }
  panelClientWidth: number
  panelScrollWidth: number
  docClientWidth: number
  docScrollWidth: number
  viewport: { width: number; height: number }
  /** Controls whose rect escapes the panel HORIZONTALLY (the reported defect). */
  hOutside: string[]
  controlCount: number
  /** The overlayscrollbars viewport inside the list, if the list is a scroller. */
  list: { scrollHeight: number; clientHeight: number } | null
}

/**
 * Read the open popover's geometry straight out of the page. Vertical clipping
 * is EXPECTED (the list is a scroll container, so a row below the fold is
 * legitimately outside the panel's vertical bounds) — only HORIZONTAL escape is
 * the defect, so `hOutside` tests the x-axis alone.
 */
async function readMetrics(page: import('@playwright/test').Page): Promise<PopoverMetrics> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-slot="popover-content"]')
    if (!panel) throw new Error('popover panel not open')
    const r = panel.getBoundingClientRect()
    const hOutside = [...panel.querySelectorAll('button,[role="button"]')]
      .filter(el => {
        const b = el.getBoundingClientRect()
        // Ignore a control scrolled out of the list viewport (zero-size).
        if (b.width === 0 && b.height === 0) return false
        return b.left < r.left - 0.5 || b.right > r.right + 0.5
      })
      .map(el => `${el.getAttribute('data-testid') ?? el.textContent?.slice(0, 24)}`)
    const listHost = panel.querySelector('[data-testid="notification-bell-list"]')
    const listViewport = listHost?.querySelector('[data-overlayscrollbars-viewport]')
    return {
      panel: {
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      },
      panelClientWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hOutside,
      controlCount: panel.querySelectorAll('button,[role="button"]').length,
      list: listViewport
        ? {
            scrollHeight: listViewport.scrollHeight,
            clientHeight: listViewport.clientHeight,
          }
        : null,
    }
  })
}

/** Open the bell popover, opening the sidebar first at narrow widths. */
async function openBell(page: import('@playwright/test').Page, width: number) {
  if (width < 768) {
    // Below the layout breakpoint the sidebar is a collapsed drawer; the bell
    // lives inside it, so it must be opened before the bell is reachable.
    const toggle = byTestId(page, 'layout-sidebar-toggle-button')
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click()
    }
  }
  const bell = byTestId(page, 'notification-bell-badge')
  await expect(bell).toBeVisible({ timeout: 30000 })
  await bell.click()
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible({
    timeout: 15000,
  })
  // The header is the pinned part of the panel — its presence means the popover
  // has laid out, not merely mounted.
  await expect(byTestId(page, 'notification-bell-mark-all')).toBeVisible({
    timeout: 15000,
  })
}

test.describe('notification bell popover — responsive containment', () => {
  test('stays inside its panel and the viewport at 320 / 390 / 1440 with many notifications', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, sql } = testInfra

    await loginAsAdmin(page, baseURL)

    // ---- Seed a POPULATED, adversarial inbox -----------------------------
    // An empty (or 1-row) panel cannot reproduce this defect at all; the report
    // is about the populated render, so the fixture must be populated.
    const adminId = (await sql(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`))
      .rows[0].id as string

    await sql(
      `INSERT INTO notifications (user_id, kind, title, body, interrupt, payload)
       VALUES ($1, 'scheduled_task_result', $2, $3, true, '{}'::jsonb)`,
      [adminId, LONG_TITLE, 'The sweep produced 148 reconciled variant records.'],
    )
    await sql(
      `INSERT INTO notifications (user_id, kind, title, body, interrupt, payload)
       VALUES ($1, 'scheduled_task_result', $2, $3, true, '{}'::jsonb)`,
      [adminId, UNBROKEN_TOKEN, UNBROKEN_TOKEN],
    )
    for (let i = 2; i < SEED_COUNT; i++) {
      await sql(
        `INSERT INTO notifications (user_id, kind, title, body, interrupt, payload)
         VALUES ($1, 'scheduled_task_result', $2, $3, true, '{}'::jsonb)`,
        [adminId, `Seeded notification ${i}`, `Body of seeded notification ${i}.`],
      )
    }

    await page.reload()

    // ---- TEST-2: the SAME contract at three widths, narrow first ---------
    // Narrow first so a desktop-only fix cannot ride on a warm layout.
    for (const { width, height } of [
      { width: 320, height: 700 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width, height })
      await page.reload()
      await openBell(page, width)

      const m = await readMetrics(page)
      const at = `at ${width}x${height}`

      // Control: the popover really is populated at this viewport, so every
      // "nothing escapes" assertion below is non-vacuous. 8 rows × (open +
      // mark-read + delete) plus the header and footer buttons.
      expect(m.controlCount, `popover should be populated ${at}`).toBeGreaterThan(8)

      // TEST-1 [acceptance, INV-1] — the page body never scrolls sideways.
      // This is the assertion that fails on origin/main at 320px (358 vs 320).
      expect(
        m.docScrollWidth,
        `document must not scroll sideways ${at} (scrollWidth vs clientWidth)`,
      ).toBeLessThanOrEqual(m.docClientWidth)

      // TEST-3 [acceptance, INV-4] — nothing is wider than the panel that draws
      // the popover background. Fails on origin/main everywhere (350 vs 288).
      expect(
        m.panelScrollWidth,
        `panel content must not overflow the panel ${at}`,
      ).toBeLessThanOrEqual(m.panelClientWidth)

      // TEST-3 [acceptance, INV-4] — and no control paints outside it. This is
      // the literal user-visible symptom: the mark-read / delete buttons drawn
      // over the page instead of inside the popover.
      expect(m.hOutside, `no control may escape the panel horizontally ${at}`).toEqual([])

      // TEST-2 [acceptance, INV-2] — the panel itself is within the viewport.
      expect(m.panel.left, `panel left edge on screen ${at}`).toBeGreaterThanOrEqual(-0.5)
      expect(m.panel.right, `panel right edge on screen ${at}`).toBeLessThanOrEqual(
        m.viewport.width + 0.5,
      )
      expect(m.panel.top, `panel top edge on screen ${at}`).toBeGreaterThanOrEqual(-0.5)
      expect(m.panel.bottom, `panel bottom edge on screen ${at}`).toBeLessThanOrEqual(
        m.viewport.height + 0.5,
      )

      // TEST-4 — the header and the footer are pinned OUTSIDE the scroller, so
      // both are reachable without scrolling the list; and the list really is
      // the (independently scrollable) overflow container.
      await expect(
        byTestId(page, 'notification-bell-mark-all'),
        `mark-all must be reachable without scrolling ${at}`,
      ).toBeVisible()
      await expect(
        byTestId(page, 'notification-bell-view-all'),
        `view-all must be reachable without scrolling ${at}`,
      ).toBeVisible()
      expect(m.list, `the list must be its own scroll container ${at}`).not.toBeNull()
      expect(
        m.list!.scrollHeight,
        `the list must actually overflow (that is what makes pinning matter) ${at}`,
      ).toBeGreaterThan(m.list!.clientHeight)
    }
  })
})
