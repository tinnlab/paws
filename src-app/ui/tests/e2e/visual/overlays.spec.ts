/**
 * Overlay OPEN-state coverage — the blind spot the audit flagged: the gallery
 * stories render only a closed trigger, and overlay content is portaled to
 * <body> (outside any gallery-section), so the per-section screenshots never
 * capture the actual dialog/sheet/popover/dropdown/menu. This spec opens each
 * overlay (Storybook-play style), then:
 *   - runs the Layer-A layout invariants on the open content (where it has a
 *     testid), and
 *   - snapshots it (Layer B) — by content testid when the kit forwards one, else
 *     full-page (Popover/Tooltip/Select listbox don't expose a content testid).
 *
 * Backend-free via the gallery Vite server. Animations are disabled (config), so
 * the open state is deterministic.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { assertLayoutSane } from '../helpers/layout'
import { SNAPSHOTS_ENABLED, openGallery } from './_gallery'

type OpenKind = 'click' | 'hover'

/**
 * Where an OPENED overlay lives, expressed as a selector rather than a page-wide
 * role query.
 *
 * Every overlay primitive portals its content OUT of the gallery canvas — the
 * open panel is a descendant of <body>, not of `[data-testid="gallery-root"]`.
 * Gallery STORIES, by contrast, may legitimately render an overlay's panel
 * INLINE inside the canvas: the composer-picker cases do exactly that (see
 * `modules/chat/gallery.tsx` — "prop-driven, so it is rendered directly rather
 * than through its Popover"), and they are permanently visible and carry
 * `role="listbox"`.
 *
 * A bare `page.getByRole('listbox').first()` therefore resolved to the composer
 * PICKER, not to the overlay under test, from the moment those cases landed. The
 * damage was not primarily the eventual hang — it was that `select` and
 * `combobox` silently stopped asserting anything: the picker is already visible,
 * so the "wait for it to open" resolved in ~0.1s and `assertLayoutSane` audited
 * the wrong element. Scoping to the portal layer makes that class of mistake
 * unrepresentable rather than merely fixed once.
 */
const portalRole = (role: string) => `[role="${role}"]:not([data-testid="gallery-root"] *)`

/**
 * How long the best-effort close between cases may wait. Deliberately far below
 * the 60s test budget: this wait exists to keep the NEXT case clean, so it must
 * never be able to consume the budget the next case needs.
 */
const CLOSE_TIMEOUT_MS = 5_000

/**
 * The overlay content handle, restricted to what is actually VISIBLE.
 *
 * `filter({ visible: true })` matters on both branches: several role-addressed
 * popups (other Selects elsewhere on the canvas) keep a zero-size portal node
 * mounted while closed, so a count without it is not a count of open overlays.
 */
function contentLocator(page: Page, o: OverlayCase): Locator | null {
  if (o.content) return page.getByTestId(o.content).filter({ visible: true })
  if (o.waitRole) return page.locator(portalRole(o.waitRole)).filter({ visible: true })
  return null
}

interface OverlayCase {
  name: string
  /** testid of the trigger to open the overlay. */
  trigger: string
  /** how to activate it. */
  kind?: OpenKind
  /** content testid the kit forwards to the portal root (enables a localized
   *  shot + layout assertion); null → snapshot full page. */
  content?: string
  /** a role to wait on when there's no content testid (e.g. select listbox). */
  waitRole?: string
  /** ms between pointer down + up on the trigger click. The base-ui Combobox
   *  opens on pointerdown and toggles closed on a same-spot pointerup, so a
   *  0-gap synthetic click double-toggles it shut (a real user's click has a
   *  natural gap and opens fine). A small delay mirrors real usage. */
  openDelay?: number
}

const OVERLAYS: OverlayCase[] = [
  { name: 'dialog', trigger: 'g-dialog-open', content: 'g-dialog' },
  { name: 'sheet', trigger: 'g-sheet-open', content: 'g-sheet' },
  // Loading arm: opens a Sheet whose body is the spinner (`loading ? <Spinner>`),
  // the state the browse-all story only renders as a closed trigger.
  { name: 'sheet-loading', trigger: 'g-sheet-loading-open', content: 'g-sheet-loading' },
  { name: 'confirm', trigger: 'g-confirm-open', content: 'g-confirm' },
  { name: 'dropdown', trigger: 'g-dropdown-open', content: 'g-dropdown' },
  // Select opens a Radix listbox (no content testid) — wait on role, shoot full page.
  { name: 'select', trigger: 'g-sel-filled', waitRole: 'listbox' },
  // Combobox's trigger is the bare <input>; its popup is a role=presentation
  // container wrapping a listbox (NOT a dialog). Open with a real-cadence click.
  { name: 'combobox', trigger: 'g-cmb-default', waitRole: 'listbox', openDelay: 100 },
  { name: 'multiselect', trigger: 'g-ms-empty', waitRole: 'dialog' },
  { name: 'popover', trigger: 'g-popover-open', waitRole: 'dialog' },
]

for (const theme of ['light', 'dark'] as const) {
  test(`overlays open — ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openGallery(page, theme, 'blue')

    for (const o of OVERLAYS) {
      await test.step(o.name, async () => {
        const trigger = page.getByTestId(o.trigger)
        await trigger.scrollIntoViewIfNeeded()

        // Resolve a handle to the open content: the kit's forwarded content
        // testid when available, else the portal's ARIA role (listbox/dialog),
        // scoped to the portal layer (see `portalRole`).
        const content = contentLocator(page, o)

        // The handle must be ABSENT before the click. Without this, an element
        // that merely HAPPENS to match — an inline story panel, a leftover
        // portal — satisfies the "wait for visible" below instantly and the case
        // degrades from "the overlay opened" to "something matched", which is
        // precisely how `select` and `combobox` went vacuous for two days
        // without turning the gate red. This is the negative control for the
        // assertion that follows it.
        if (content)
          await expect(
            content,
            `${o.name}: something already matches this overlay's content selector ` +
              `BEFORE the trigger was clicked, so "it opened" cannot be asserted`,
          ).toHaveCount(0)

        if (o.kind === 'hover') await trigger.hover()
        else await trigger.click(o.openDelay ? { delay: o.openDelay } : {})

        // Wait for it to settle — if the trigger failed to open, this times out
        // and FAILS (no catch), so "opened" is genuinely asserted. EXACTLY one
        // match, not `.first()`: an ambiguous resolution is a defect in the
        // spec's ability to see the surface, and silently picking one is how
        // that defect stays invisible.
        if (content)
          await expect(
            content,
            `${o.name}: expected exactly one visible portalled overlay after opening`,
          ).toHaveCount(1)

        // Layer A — invariants on the open content for EVERY overlay (incl. the
        // role-resolved listbox/dialog cases). Overlays are dense layout surfaces;
        // this is where header/body/footer/action/option alignment bugs live.
        if (content) {
          await assertLayoutSane(content, { checks: { horizontalScroll: false } })
        }

        // Layer B — snapshot the open overlay (opt-in; needs blessed baselines).
        if (SNAPSHOTS_ENABLED) {
          const shot = content ?? page
          await expect(shot).toHaveScreenshot(`overlay-${o.name}-${theme}.png`)
        }

        // Close so the next overlay opens clean. Best-effort BY DESIGN — but the
        // bound is what makes it best-effort: `locator.waitFor` has no default
        // timeout, so without one the `.catch()` below can never fire and an
        // overlay that fails to close consumes the whole 60s test budget, then
        // reports the timeout against the NEXT case's first action. That is how
        // this file's real failure arrived disguised as
        // `scrollIntoViewIfNeeded: ... browser has been closed`.
        await page.keyboard.press('Escape')
        if (content)
          await content
            .waitFor({ state: 'hidden', timeout: CLOSE_TIMEOUT_MS })
            .catch(() => undefined)
      })
    }
  })
}
