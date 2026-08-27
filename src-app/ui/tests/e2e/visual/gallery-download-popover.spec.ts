/**
 * TEST-4 [covers: ITEM-3] — the Downloads popover has a gallery state that
 * renders it OPEN, WITH DATA.
 *
 * ## Why this spec exists
 *
 * The panel-overflow defect (ITEM-1/ITEM-2) was invisible to every automated
 * gate, and the reason is this surface's gallery coverage: its ONLY state was
 * `seeded-download-indicator-empty`, whose whole point is that the widget
 * returns `null` and renders nothing at all. The state matrix's `:open` cell was
 * marked `skip: true` with the reason "proven by Part 2 runtime coverage" —
 * true of the BRANCH, and useless for the surface, because a popover that is
 * never opened with rows in it cannot show a row painting outside the panel.
 *
 * So the missing state is itself part of the fix, and this spec is what stops it
 * silently regressing to "empty only" again: it drives the real interaction and
 * fails if the story is missing, renders closed, or renders without rows.
 *
 * Backend-free, against `/gallery.html` (playwright.visual.config boots vite).
 * The geometric containment assertions live in
 * `tests/e2e/llm/download-popover-responsive.spec.ts` (TEST-1), which runs
 * against the real backend at three viewports — this spec's job is that the
 * state EXISTS and is populated.
 */
import { test, expect, type Page } from '@playwright/test'

const SLUG = 'seeded-download-indicator-open'
const INTERACT = 'open-downloads'

async function gotoSurface(page: Page, slug: string, extra = '') {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => {
    // Ignore benign non-/api asset failures (they hit vite, not the mock) — the
    // runtime-health gate filters these too; a real bug is a JS error.
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text()))
      errors.push(m.text())
  })
  await page.goto(`/gallery.html?surface=${slug}&theme=light&accent=blue${extra}`)
  await page.getByTestId('gallery-root').waitFor()
  await page.getByTestId(`gallery-page-${slug}`).waitFor({ timeout: 15000 })
  return errors
}

test('TEST-4: the downloads popover gallery state renders OPEN with an active + a failed row', async ({
  page,
}) => {
  const errors = await gotoSurface(page, SLUG, `&interact=${INTERACT}`)

  const frame = page.getByTestId(`gallery-page-${SLUG}`)

  // The interaction recipe ran to completion. Without this the assertions below
  // could pass against a half-mounted surface, or hang on a recipe that never
  // fired because the slug/interaction name drifted. The runtime stamps the
  // marker on `document.body` (`runtime/interactions.ts`), not inside the
  // frame, and its VALUE is the recipe name — so this also catches the case
  // where some other recipe ran instead of this one.
  await expect(page.locator(`body[data-gallery-interact-done="${INTERACT}"]`)).toHaveCount(
    1,
    { timeout: 20000 },
  )

  // No error-boundary crash marker.
  await expect(frame.getByTestId('gallery-crash')).toHaveCount(0)

  // The panel is genuinely OPEN — this is the state that did not exist before.
  const panel = page.locator('[data-slot="popover-content"]')
  await expect(panel).toBeVisible({ timeout: 15000 })

  // …and POPULATED with BOTH arms. An empty or single-row panel fits at any
  // width and would have hidden the defect exactly as the empty state did, so
  // asserting the count is what makes this state worth having.
  await expect(page.locator('[data-testid="llm-download-item-card"]')).toHaveCount(2)
  await expect(panel).toContainText('Active Downloads (1)')
  await expect(panel).toContainText('Failed Downloads (1)')

  // The failed arm's controls render — they are the widest things in the panel
  // and were among the elements painting outside it.
  await expect(panel.getByTestId('llm-download-clear-btn-dl-open-failed')).toBeVisible()
  await expect(panel.getByTestId('llm-download-retry-btn-dl-open-failed')).toBeVisible()

  // The long display name reaches the DOM in full (CSS truncation, not a JS
  // slice) — the seeded name is deliberately longer than the old 30-char cut.
  await expect(panel).toContainText('Qwen3.5 9B Instruct')

  expect(errors, `console/page errors on ${SLUG}: ${errors.join(' | ')}`).toEqual([])
})
