import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * TEST-1 [acceptance] [invariant: INV-1] — the sidebar Downloads panel stays
 * inside its own box, and inside the viewport, at every width, with rows in it.
 *
 * The owner reported: *"while a download is running, the progress bar and the
 * percentage render outside that box."* Measured on `origin/main`, the widget
 * wrapped its content in an inline `style={{ width: 320, maxHeight: 440 }}`
 * while the kit popover popup is `w-72` (288px) with `p-2.5` — 268px usable —
 * so 52px of every row painted outside the popover's background, and the height
 * bound was not viewport-relative at all.
 *
 * ## Why these assertions and not `toBeVisible()`
 *
 * Visibility is exactly what did NOT catch this — and there is a spec in this
 * very directory (`download-indicator-widget.spec.ts`) that opens this popover,
 * asserts the row is visible, and passes against the broken build. Every
 * control WAS visible; it was just drawn on top of the page instead of inside
 * the panel. So each assertion here is GEOMETRIC:
 *
 *  - INV-1 → panel `scrollWidth === clientWidth` (nothing overflows the panel)
 *  - INV-1 → every control's rect lies horizontally inside the panel's rect
 *  - INV-1 → `documentElement.scrollWidth === clientWidth` (no sideways body
 *            scroll — the 320px case, where a fixed 320px panel plus the
 *            popover's own offset pushed the document wider than the viewport)
 *  - INV-1 → the percentage element sits inside the panel, which is the
 *            SECOND, independent overflow: the name/percent row had no
 *            `min-w-0`, so a long name pushed the percentage out even once the
 *            panel itself was bounded.
 *
 * ## Fixture
 *
 * Rows are seeded straight into the per-test DB (mirroring
 * `15-notifications/bell-popover-responsive.spec.ts`) and served by the REAL
 * `GET /api/llm-models/downloads` endpoint — no `page.route` mocking, so the
 * store, the widget and the layout all run for real.
 *
 * The fixture is deliberately ADVERSARIAL, because a short name in a
 * single-row panel fits at any width and reproduces nothing:
 *  - one `downloading` row AND one `failed` row (the failed arm adds the
 *    Clear/Retry buttons, which are the widest controls in the panel),
 *  - a long display name on the active row (the `min-w-0` case).
 */

/** Widths that matter: the two mobile ones plus desktop. */
const WIDTHS = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]

/** A name long enough that CSS truncation is the only thing that can fit it. */
const LONG_NAME =
  'Qwen3.5 9B Instruct — Q4_K_M (tinnlab mirror of the unsloth GGUF build)'

interface PanelMetrics {
  panel: { left: number; right: number }
  panelClientWidth: number
  panelScrollWidth: number
  docClientWidth: number
  docScrollWidth: number
  /** Controls whose rect escapes the panel HORIZONTALLY (the reported defect). */
  hOutside: string[]
  controlCount: number
  /** The percentage + progress-bar boxes, measured against the panel. */
  rows: { testid: string; right: number; left: number; overflows: boolean }[]
}

/**
 * Read the open panel's geometry out of the page.
 *
 * Vertical clipping is EXPECTED — the list is a `ScrollArea axis="y"`, so a row
 * below the fold is legitimately outside the panel's vertical bounds. Only
 * HORIZONTAL escape is the defect, so every check here is on the x-axis.
 */
async function readMetrics(
  page: import('@playwright/test').Page,
): Promise<PanelMetrics> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-slot="popover-content"]')
    if (!panel) throw new Error('downloads panel not open')
    const r = panel.getBoundingClientRect()

    const escapes = (b: DOMRect) => b.left < r.left - 0.5 || b.right > r.right + 0.5

    const hOutside = [...panel.querySelectorAll('button,[role="button"]')]
      .filter(el => {
        const b = el.getBoundingClientRect()
        // A control the panel has not laid out at all has a zero-size rect and
        // no meaningful position; one merely scrolled out of the list viewport
        // KEEPS its laid-out rect and is intentionally still checked.
        if (b.width === 0 && b.height === 0) return false
        return escapes(b)
      })
      .map(el => `${el.getAttribute('data-testid') ?? el.textContent?.slice(0, 24)}`)

    const rows = [
      ...panel.querySelectorAll(
        '[data-testid="llm-download-item-percent"],[data-testid="llm-download-progress"],[data-testid="llm-download-item-name"]',
      ),
    ].map(el => {
      const b = el.getBoundingClientRect()
      return {
        testid: el.getAttribute('data-testid') ?? '?',
        left: +b.left.toFixed(1),
        right: +b.right.toFixed(1),
        overflows: escapes(b),
      }
    })

    return {
      panel: { left: +r.left.toFixed(1), right: +r.right.toFixed(1) },
      panelClientWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      hOutside,
      controlCount: panel.querySelectorAll('button,[role="button"]').length,
      rows,
    }
  })
}

/**
 * Open the Downloads panel, opening the sidebar first at narrow widths.
 *
 * Below the layout breakpoint the sidebar is a Sheet (a Base-UI Dialog) that
 * starts CLOSED and the widget lives inside it, so on a narrow viewport the
 * sidebar must be opened before the badge exists in the DOM at all. Waiting for
 * `app-sidebar` to be hidden first is how the sibling bell spec establishes that
 * the app has hydrated; clicking the toggle before that races the mount and
 * silently no-ops.
 */
async function openDownloads(
  page: import('@playwright/test').Page,
  width: number,
) {
  const sidebar = byTestId(page, 'app-sidebar')
  if (width < 768) {
    await expect(sidebar).toBeHidden({ timeout: 30000 })
    await byTestId(page, 'layout-sidebar-toggle-button').click()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
  } else {
    await expect(sidebar).toBeVisible({ timeout: 30000 })
  }
  const badge = byTestId(page, 'llm-download-indicator-badge')
  await expect(badge).toBeVisible({ timeout: 30000 })
  await badge.click()
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible({
    timeout: 15000,
  })
  // Both rows laid out — presence of the item cards means the panel has laid
  // out, not merely mounted, so the measurements below are of real boxes.
  await expect(
    page.locator('[data-testid="llm-download-item-card"]'),
  ).toHaveCount(2, { timeout: 15000 })
}

test.describe('downloads panel — responsive containment', () => {
  test('stays inside its panel and the viewport at 320 / 390 / 1440 with an active + a failed download', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, sql } = testInfra

    await loginAsAdmin(page, baseURL)

    // ---- Seed a POPULATED, adversarial downloads list --------------------
    // `download_instances.provider_id` / `.repository_id` are NOT NULL with
    // FKs, so both must be real rows. The seeded built-in local provider and
    // the seeded Hugging Face repository are present on every fresh install.
    const providerId = (
      await sql(
        `SELECT id FROM llm_providers WHERE provider_type = 'local' ORDER BY built_in DESC LIMIT 1`,
      )
    ).rows[0].id as string
    const repositoryId = (
      await sql(`SELECT id FROM llm_repositories ORDER BY built_in DESC LIMIT 1`)
    ).rows[0].id as string

    const seed = async (
      status: 'downloading' | 'failed',
      displayName: string,
      current: number,
    ) =>
      sql(
        `INSERT INTO download_instances
           (provider_id, repository_id, status, request_data, progress_data, error_message)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [
          providerId,
          repositoryId,
          status,
          JSON.stringify({
            model_name: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            display_name: displayName,
            repository_path: 'Qwen3.5-9B-GGUF',
            main_filename: 'Qwen3.5-9B-Q4_K_M.gguf',
            file_format: 'gguf',
          }),
          JSON.stringify({
            current,
            total: 6_100_000_000,
            phase: 'downloading',
            message: 'Fetching weights…',
            speed_bps: 5_242_880,
            eta_seconds: 468,
          }),
          status === 'failed' ? 'connection reset by peer after 2.1 GB' : null,
        ],
      )

    await seed('downloading', LONG_NAME, 3_650_722_201)
    await seed('failed', 'Mistral Small 3 24B Instruct — Q5_K_M', 2_100_000_000)

    for (const size of WIDTHS) {
      await page.setViewportSize(size)
      await page.goto(`${baseURL}/`)
      await page.waitForLoadState('load')

      await openDownloads(page, size.width)
      const m = await readMetrics(page)
      const where = `at ${size.width}px`

      // The fixture must actually have produced controls to measure —
      // otherwise every assertion below passes vacuously.
      expect(m.controlCount, `${where}: panel has controls to measure`).toBeGreaterThan(0)
      expect(m.rows.length, `${where}: panel has rows to measure`).toBeGreaterThan(0)

      // INV-1 — nothing overflows the panel horizontally.
      expect(m.panelScrollWidth, `${where}: panel scrollWidth vs clientWidth ${JSON.stringify(m)}`)
        .toBe(m.panelClientWidth)
      expect(m.hOutside, `${where}: controls outside the panel ${JSON.stringify(m)}`).toEqual([])

      // INV-1 — the progress bar, the percentage and the name are all inside.
      // This is the leg that catches the intra-row overflow, which the panel's
      // own scrollWidth cannot see: the list is a `ScrollArea axis="y"` whose
      // viewport clips the x-axis, so a row overflowing sideways never
      // propagates out to the panel.
      const escaped = m.rows.filter(row => row.overflows)
      expect(escaped, `${where}: row elements outside the panel ${JSON.stringify(m)}`).toEqual([])

      // INV-1 — no sideways body scroll.
      expect(m.docScrollWidth, `${where}: document scrollWidth vs clientWidth ${JSON.stringify(m)}`)
        .toBe(m.docClientWidth)
    }
  })
})
