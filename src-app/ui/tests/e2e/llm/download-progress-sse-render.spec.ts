import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * TEST-12 — the RENDERED download progress must move when SSE frames arrive.
 *
 * The owner watched a 5.68 GB model download run to completion while the
 * onboarding step showed 0% and the LLM-providers view read "0 bytes / 0 bytes".
 * The record was correct throughout (queried live mid-transfer:
 * `current 5637699037 / total 5680522464`) and the server was broadcasting — the
 * CONSUMER was wrong. `{ ...download, ...update }` grafted the wire event's FLAT
 * fields onto the row as strays and never touched `progress_data`, which is the
 * only thing any download surface reads.
 *
 * SCOPE, stated honestly. `CODING_GUIDELINES` §14 says e2e specs must drive the
 * real backend and not `page.route()`-mock the API. This spec is a deliberate
 * exception, and it is a real one: the two endpoints served from fixtures ARE
 * the entire server side of this feature, and the `update` frame is hand-written
 * here. What that buys is coverage of everything downstream of the wire — the
 * real api-client SSE transport, the real store merge, the real `DownloadItem`
 * render — which is exactly where the defect was.
 *
 * The alternative was not a better test but no test: a genuine 5.68 GB transfer
 * cannot run in e2e, and the store only subscribes once a download is already in
 * it (`setupDownloadTracking.ts`), so the list must be seeded either way. The
 * frame's SHAPE is not trusted to this file — TEST-9 pins it server-side against
 * the real `From<&DownloadInstance>`, so a wire change fails there rather than
 * silently making this fixture a lie.
 *
 * The fixture starts the row at the exact zeros the user was stuck on, so a
 * regression reproduces the reported symptom rather than an abstract one.
 */

const DOWNLOAD_ID = '11111111-1111-1111-1111-111111111111'
const PROVIDER_ID = '22222222-2222-2222-2222-222222222222'

/** The row as `listDownloads` returns it for a just-started download. */
const SEEDED_ROW = {
  id: DOWNLOAD_ID,
  provider_id: PROVIDER_ID,
  repository_id: '33333333-3333-3333-3333-333333333333',
  status: 'downloading',
  created_at: '2026-08-24T18:29:00Z',
  started_at: '2026-08-24T18:29:00Z',
  updated_at: '2026-08-24T18:29:00Z',
  request_data: {
    model_name: 'qwen-progress-model',
    display_name: 'Qwen Progress Model',
    repository_path: 'org/qwen-progress-model',
  },
  progress_data: {
    current: 0,
    total: 0,
    eta_seconds: 0,
    message: '',
    phase: 'created',
    speed_bps: 0,
  },
}

/**
 * The wire shape the server actually sends: `DownloadProgressUpdate` is FLAT —
 * `current`/`total`/`speed_bps`/`eta_seconds`/`message`/`phase` at the TOP
 * level, NOT nested under `progress_data`. Pinned server-side by TEST-9.
 */
function updateFrame(current: number, total: number, speedBps: number): string {
  const payload = JSON.stringify([
    {
      id: DOWNLOAD_ID,
      provider_id: PROVIDER_ID,
      status: 'downloading',
      phase: 'downloading',
      current,
      total,
      speed_bps: speedBps,
      eta_seconds: 26,
      message: 'Downloading model weights',
      error_message: null,
      model_id: null,
    },
  ])
  return `event: update\ndata: ${payload}\n\n`
}

test.describe('LLM downloads — SSE progress reaches the rendered surface', () => {
  test('the rendered percent moves off 0% when a progress frame arrives', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    await page.route(/\/api\/llm-models\/downloads(\?.*)?$/, async (route, req) => {
      if (req.method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          downloads: [SEEDED_ROW],
          page: 1,
          per_page: 50,
          total: 1,
        }),
      })
    })

    // The real SSE endpoint, serving the handshake then one progress frame.
    await page.route(/\/api\/llm-models\/downloads\/subscribe$/, async (route) => {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body:
          `event: connected\ndata: ${JSON.stringify({ message: 'ok' })}\n\n` +
          // 90.6% — the figure measured on disk while the UI showed 0%.
          updateFrame(5_147_144_752, 5_680_522_464, 516_096),
      })
    })

    await page.goto(`${baseURL}/`)

    const indicator = byTestId(page, 'llm-download-indicator-badge')
    await expect(indicator).toBeVisible({ timeout: 30000 })
    await indicator.click()

    const item = page.locator('[data-testid="llm-download-item-card"]').first()
    await expect(item).toBeVisible({ timeout: 10000 })
    await expect(item).toContainText('Qwen Progress Model')

    // THE assertion: the rendered percent reflects the delivered bytes. Before
    // the fix this stayed "0%" for the entire transfer.
    await expect(item).toContainText('91%', { timeout: 15000 })
    await expect(item).not.toContainText('0%')
  })

  test('POSITIVE CONTROL: without a progress frame the surface renders 0%', async ({
    page,
    testInfra,
  }) => {
    // Proves the assertion above is measuring DELIVERY and not merely that the
    // widget can render a number: the same seeded row, with the stream serving
    // only its handshake, must still read 0%.
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    await page.route(/\/api\/llm-models\/downloads(\?.*)?$/, async (route, req) => {
      if (req.method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          downloads: [SEEDED_ROW],
          page: 1,
          per_page: 50,
          total: 1,
        }),
      })
    })
    await page.route(/\/api\/llm-models\/downloads\/subscribe$/, async (route) => {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: `event: connected\ndata: ${JSON.stringify({ message: 'ok' })}\n\n`,
      })
    })

    await page.goto(`${baseURL}/`)
    const indicator = byTestId(page, 'llm-download-indicator-badge')
    await expect(indicator).toBeVisible({ timeout: 30000 })
    await indicator.click()

    const item = page.locator('[data-testid="llm-download-item-card"]').first()
    await expect(item).toBeVisible({ timeout: 10000 })
    await expect(item).toContainText('0%')
  })
})
