import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

import { test, expect } from '../fixtures/test-context'
import { installTauriMock } from './helpers/tauri-mock'

/**
 * TEST-6 [acceptance] [invariant: INV-2] — the notification and download icons
 * occupy ONE row, side by side, in the DESKTOP layout.
 *
 * ## Why a desktop spec exists at all, when the component is shared
 *
 * `LeftSidebar.desktop.tsx` returns the core component verbatim off macOS, so
 * it would be tempting to argue the web spec (TEST-5) covers desktop too. It
 * does not, and the difference is not cosmetic: desktop runs a DIFFERENT MODULE
 * GRAPH. `modules/loader.desktop.ts`'s `CORE_MODULE_BLOCKLIST` drops
 * `user-profile`, so the `sidebarFooter` below this row is empty and the row is
 * the last thing in the sidebar — a layout the web build never renders. An
 * argument about shared code is not a measurement of the shipped layout, and
 * INV-2 says "in BOTH the web and the desktop layout".
 *
 * Uses the real backend fixture (no `mockBackendDefaults`), so the sidebar,
 * the notification store and the download store all run against a live server.
 * The download row is seeded straight into the per-test database, because there
 * is no API that creates a `download_instances` row without performing a real
 * multi-GB transfer.
 */

const LONG_NAME = 'Qwen3.5 9B Instruct — Q4_K_M (tinnlab mirror)'

/**
 * Connect to the per-test database.
 *
 * The port is read from the same `postgres-<runId>.json` global-setup writes
 * and the fixture itself reads; the database name comes from `testInfra`. This
 * deliberately does NOT reach into the fixture's internals or modify the shared
 * harness — it reads the harness's own published output.
 */
async function connectToTestDb(databaseName: string): Promise<Client> {
  const runId = process.env.TEST_RUN_ID
  if (!runId) throw new Error('TEST_RUN_ID not set — global-setup may have failed')
  const configDir = resolve(__dirname, '../.test-configs')
  const postgresConfig = JSON.parse(
    readFileSync(resolve(configDir, `postgres-${runId}.json`), 'utf-8'),
  )
  const client = new Client({
    host: 'localhost',
    port: postgresConfig.port as number,
    user: 'postgres',
    password: 'password',
    database: databaseName,
  })
  await client.connect()
  return client
}

interface IconBoxes {
  bell: { top: number; bottom: number; left: number; right: number } | null
  download: { top: number; bottom: number; left: number; right: number } | null
  rowDisplay: string | null
  footerChildren: number
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
    const row = document.querySelector(
      '[data-testid="layout-sidebar-bottom-widgets"]',
    )
    return {
      bell: box('[data-testid="notification-bell-badge"]'),
      download: box('[data-testid="llm-download-indicator-badge"]'),
      rowDisplay: row ? getComputedStyle(row).display : null,
      // Desktop blocklists `user-profile`, so the footer slot contributes
      // nothing — the row is the last thing in the sidebar here.
      footerChildren: document.querySelectorAll(
        '[data-testid="user-profile-widget"]',
      ).length,
    }
  })
}

test.describe('desktop sidebar bottom widgets — one row', () => {
  test('the notification bell and the download indicator share one row in the desktop shell', async ({
    page,
    testInfra,
  }) => {
    const db = await connectToTestDb(testInfra.databaseName)
    try {
      const providerId = (
        await db.query(
          `SELECT id FROM llm_providers WHERE provider_type = 'local' ORDER BY built_in DESC LIMIT 1`,
        )
      ).rows[0].id as string
      const repositoryId = (
        await db.query(
          `SELECT id FROM llm_repositories ORDER BY built_in DESC LIMIT 1`,
        )
      ).rows[0].id as string

      await db.query(
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
    } finally {
      await db.end()
    }

    // Real backend, Tauri shim only — no `mockBackendDefaults`, so every
    // /api call lands on the spawned server.
    await installTauriMock(page, {
      backendPort: testInfra.backendPort,
      tokens: testInfra.tokens,
    })

    await page.goto('/')
    await expect(page.getByTestId('desktop-bootstrap-starting')).toBeHidden({
      timeout: 30_000,
    })

    const row = page.getByTestId('layout-sidebar-bottom-widgets')
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('notification-bell-badge')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('llm-download-indicator-badge')).toBeVisible({
      timeout: 30_000,
    })

    const m = await readIconBoxes(page)
    const detail = JSON.stringify(m)
    expect(m.bell, `bell present ${detail}`).not.toBeNull()
    expect(m.download, `download indicator present ${detail}`).not.toBeNull()

    const bell = m.bell!
    const dl = m.download!

    // SAME ROW: vertical bands overlap. Two stacked rows cannot satisfy this.
    expect(
      Math.min(bell.bottom, dl.bottom) - Math.max(bell.top, dl.top),
      `icons must share a horizontal band ${detail}`,
    ).toBeGreaterThan(0)

    // SIDE BY SIDE: horizontal boxes are adjacent, not overlapping.
    expect(
      Math.min(bell.right, dl.right) - Math.max(bell.left, dl.left),
      `icons must be horizontally adjacent ${detail}`,
    ).toBeLessThanOrEqual(0)

    // The desktop-specific fact that makes this spec more than a copy of the
    // web one: there is no user-profile widget below the row here.
    expect(
      m.footerChildren,
      `desktop blocklists user-profile, so the footer is empty ${detail}`,
    ).toBe(0)
  })
})
