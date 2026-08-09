/**
 * TEST-9 [acceptance · INV-4] — the DESKTOP workspace enumerates surfaces through
 * the ONE shared module, in a real browser, against the real desktop gallery.
 *
 * `src-app/desktop/ui/scripts/lib/gallery-surfaces.mjs` used to be a stale fork
 * that had no notion of the `interaction` surface class. Desktop's crawl already
 * ran the sdk copy (via `gate:ui` / `gallery:runtime`) while `gallery:states`,
 * `gallery:screenshots`, `affordance-audit` and `gen-crop-review-manifests`
 * imported the local stale one — so the workspace disagreed with ITSELF about
 * what a surface is.
 *
 * That disagreement is invisible today only because no desktop-only module has
 * registered a recipe yet, and it fails SILENTLY when one does: the stale
 * `captureCells()` simply emits fewer cells and `surfaceCount()` returns a
 * smaller total. Nothing throws. So this spec does not wait for a recipe to
 * exist — it injects one into the LIVE page and proves the enumeration the
 * desktop workspace now resolves carries it end to end.
 *
 * Run: npx playwright test -c playwright.gallery.config.ts gallery-desktop-surfaces
 */
import { test, expect } from '@playwright/test'
// @ts-ignore — the shared Node-side enumeration module (single source; no local copy)
import {
  enumerateSurfaces,
  captureCells,
  cellUrl,
  surfaceCount,
  // @ts-ignore
} from '@ziee/gallery/scripts/lib/gallery-surfaces.mjs'

const RECIPE = { slug: 'modules/desktop-probe/components/Probe', name: 'menu-open' }

test('desktop enumerates surfaces through the shared module, interactions included', async ({
  page,
  baseURL,
}) => {
  const base = `${baseURL}/gallery.html`

  // ── Positive control ──────────────────────────────────────────────────────
  // The desktop gallery must actually have rendered. Without this, every
  // "absent"/"empty" assertion below would pass just as well against a blank page.
  //
  // Wait on the CONDITION, not a fixed sleep: the shared enumeration settles with a
  // flat `waitForTimeout`, and `mountGallery` does not await `cfg.loadModules()`
  // (CLAUDE.md follow-up 2), so on a loaded box the mount is genuinely racy.
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () =>
      ((window as unknown as Record<string, () => { pages: unknown[] }>)
        .__GALLERY_LIST_ALL_SURFACES__?.()?.pages?.length ?? 0) > 0,
    undefined,
    { timeout: 60_000 },
  )
  const before = await enumerateSurfaces(page)
  expect(before.pages.length, 'the desktop gallery must render pages').toBeGreaterThan(0)

  // The shared module always reports the class; the stale fork returned an object
  // with no such key at all.
  expect(Array.isArray(before.interactions), 'enumeration must carry an `interactions` array').toBe(
    true,
  )

  // ── The invariant ─────────────────────────────────────────────────────────
  // Inject one recipe into the live gallery and re-enumerate through the SAME
  // module the capture/audit scripts now import.
  await page.evaluate(recipe => {
    const w = window as unknown as Record<string, unknown>
    const prev = w.__GALLERY_LIST_ALL_SURFACES__ as undefined | (() => Record<string, unknown[]>)
    w.__GALLERY_LIST_ALL_SURFACES__ = () => {
      const r = prev ? prev() : { pages: [], overlays: [], deep: [], seeded: [], interactions: [] }
      return { ...r, interactions: [...((r.interactions as unknown[]) || []), recipe] }
    }
  }, RECIPE)

  const after = await enumerateSurfaces(page)
  expect(after.interactions).toContainEqual(RECIPE)

  const cells = captureCells(after)
  const cell = cells.find((c: { cls: string }) => c.cls === 'interaction')
  expect(cell, 'a recipe must produce an interaction capture cell').toBeTruthy()
  expect(cell).toMatchObject({ slug: RECIPE.slug, state: RECIPE.name, interact: RECIPE.name })
  expect(cellUrl(base, cell)).toMatch(/[?&]interact=menu-open\b/)

  // It must be COUNTED — undercounting is exactly how the stale copy lost work
  // without reporting anything.
  expect(surfaceCount(after)).toBe(surfaceCount(before) + 1)

  // ── Negative control ──────────────────────────────────────────────────────
  // "Interactions are handled" must not be satisfiable by over-reporting: every
  // other class, and every other cell, is unchanged.
  expect(after.pages).toEqual(before.pages)
  expect(after.overlays).toEqual(before.overlays)
  expect(after.deep).toEqual(before.deep)
  expect(after.seeded).toEqual(before.seeded)
  // Relative to what was already there — NOT a hardcoded 1. Desktop registers zero
  // recipes today, and this spec exists precisely for the moment one is added; a
  // literal 1 would go red on that healthy tree.
  expect(cells.filter((c: { cls: string }) => c.cls === 'interaction')).toHaveLength(
    before.interactions.length + 1,
  )
  expect(cells.filter((c: { cls: string }) => c.cls === 'page')).toHaveLength(
    before.pages.length * 3,
  )
})
