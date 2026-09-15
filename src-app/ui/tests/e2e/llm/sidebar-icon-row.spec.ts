import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * TEST-5 [acceptance] [invariant: INV-2] — the notification and download icons
 * occupy ONE row, side by side, and the row is still correct with only one of
 * them present.
 *
 * The owner reported: *"they currently occupy two separate rows in the left
 * menu; put them on one row, side by side."* `LeftSidebar` rendered each
 * `sidebarBottom` widget in a bare block `<div>`, so the two stacked.
 *
 * ## Why the one-child leg is not an edge case
 *
 * `DownloadIndicatorWidget` returns `null` whenever there is no active or
 * failed download — which is its NORMAL state. So "the row with one child" is
 * what a user sees almost all of the time, and a row that only looks right with
 * two children would be broken in the common case. Both legs are asserted.
 *
 * ## Why geometric, not `toBeVisible()`
 *
 * Both icons were perfectly visible before this change; they were just on
 * different rows. Visibility cannot tell one row from two. So the assertion is
 * that their vertical bands OVERLAP (same row) and that neither sits entirely
 * below the other (not stacked).
 */

const LONG_NAME = 'Qwen3.5 9B Instruct — Q4_K_M (tinnlab mirror)'

interface IconBoxes {
  bell: { top: number; bottom: number; left: number; right: number } | null
  download: { top: number; bottom: number; left: number; right: number } | null
}

async function readIconBoxes(
  page: import('@playwright/test').Page,
): Promise<IconBoxes> {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      if (b.width === 0 && b.height === 0) return null
      return {
        top: +b.top.toFixed(1),
        bottom: +b.bottom.toFixed(1),
        left: +b.left.toFixed(1),
        right: +b.right.toFixed(1),
      }
    }
    return {
      bell: box('[data-testid="notification-bell-badge"]'),
      download: box('[data-testid="llm-download-indicator-badge"]'),
    }
  })
}

/** Seed one in-flight download so the download indicator renders at all. */
async function seedActiveDownload(
  sql: (text: string, params?: unknown[]) => Promise<import('pg').QueryResult>,
) {
  const providerId = (
    await sql(
      `SELECT id FROM llm_providers WHERE provider_type = 'local' ORDER BY built_in DESC LIMIT 1`,
    )
  ).rows[0].id as string
  const repositoryId = (
    await sql(`SELECT id FROM llm_repositories ORDER BY built_in DESC LIMIT 1`)
  ).rows[0].id as string

  await sql(
    `INSERT INTO download_instances
       (provider_id, repository_id, status, request_data, progress_data)
     VALUES ($1, $2, 'downloading', $3::jsonb, $4::jsonb)`,
    [
      providerId,
      repositoryId,
      JSON.stringify({
        model_name: 'qwen3-5-9b',
        display_name: LONG_NAME,
        repository_path: 'Qwen3.5-9B-GGUF',
        main_filename: 'Qwen3.5-9B-Q4_K_M.gguf',
        file_format: 'gguf',
      }),
      JSON.stringify({
        current: 3_650_722_201,
        total: 6_100_000_000,
        phase: 'downloading',
        message: 'Fetching weights…',
        speed_bps: 5_242_880,
        eta_seconds: 468,
      }),
    ],
  )
}

test.describe('sidebar bottom widgets — one row', () => {
  test('the notification bell and the download indicator share one row, and the row is correct with only the bell', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, sql } = testInfra

    await loginAsAdmin(page, baseURL)

    // ---- Leg 1: ONE child (no downloads) --------------------------------
    // This is the ordinary state, so assert it first and assert it is not
    // vacuous — the bell must actually be there.
    await page.goto(`${baseURL}/`)
    await page.waitForLoadState('load')
    await expect(byTestId(page, 'app-sidebar')).toBeVisible({ timeout: 30000 })

    const row = byTestId(page, 'layout-sidebar-bottom-widgets')
    await expect(row).toBeVisible({ timeout: 30000 })
    await expect(byTestId(page, 'notification-bell-badge')).toBeVisible({
      timeout: 30000,
    })
    await expect(
      byTestId(page, 'llm-download-indicator-badge'),
    ).toHaveCount(0)

    const soloBell = await readIconBoxes(page)
    expect(soloBell.bell, 'the bell renders with no download in flight').not.toBeNull()
    expect(soloBell.download, 'no download indicator without a download').toBeNull()

    // The lone bell sits INSIDE the row container, not floating beside it.
    const rowBox = await row.boundingBox()
    expect(rowBox, 'the bottom-widget row has a box').not.toBeNull()
    expect(soloBell.bell!.left).toBeGreaterThanOrEqual(rowBox!.x - 0.5)
    expect(soloBell.bell!.right).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 0.5)

    // ---- Leg 2: TWO children, one row -----------------------------------
    await seedActiveDownload(sql)
    await page.goto(`${baseURL}/`)
    await page.waitForLoadState('load')
    await expect(byTestId(page, 'app-sidebar')).toBeVisible({ timeout: 30000 })
    await expect(byTestId(page, 'llm-download-indicator-badge')).toBeVisible({
      timeout: 30000,
    })

    const both = await readIconBoxes(page)
    expect(both.bell, 'bell present').not.toBeNull()
    expect(both.download, 'download indicator present').not.toBeNull()

    const bell = both.bell!
    const dl = both.download!
    const detail = JSON.stringify(both)

    // SAME ROW: their vertical bands overlap. Two stacked full-width rows
    // cannot satisfy this — that is the whole defect.
    expect(
      Math.min(bell.bottom, dl.bottom) - Math.max(bell.top, dl.top),
      `icons must share a horizontal band ${detail}`,
    ).toBeGreaterThan(0)

    // NOT STACKED: neither starts below the other's bottom edge.
    expect(bell.top, `bell must not sit below the download icon ${detail}`).toBeLessThan(
      dl.bottom,
    )
    expect(dl.top, `download icon must not sit below the bell ${detail}`).toBeLessThan(
      bell.bottom,
    )

    // SIDE BY SIDE: their horizontal boxes do not overlap (they are adjacent,
    // not on top of each other).
    const hOverlap = Math.min(bell.right, dl.right) - Math.max(bell.left, dl.left)
    expect(hOverlap, `icons must be horizontally adjacent, not overlapping ${detail}`).toBeLessThanOrEqual(0)
  })
})
