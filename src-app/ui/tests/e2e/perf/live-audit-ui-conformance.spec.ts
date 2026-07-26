import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * REGRESSION GUARDS for the two NON-network `live-ui-audit` findings, expressed
 * as the audit's own measurable signals so a future regression fails here rather
 * than in a manual audit run:
 *
 *   - `overflow-x`    — "body scrollWidth N > viewport 390 — horizontal scroll",
 *                       plus "interactive control clipped by viewport edge".
 *                       A live sweep reported this on 27 surfaces and traced it
 *                       to one shared shell container; it does NOT reproduce on
 *                       a correct build (see PLAN_AUDIT.md — the reported build
 *                       linked a partial CSS bundle missing `.flex-1` /
 *                       `.min-w-0` / `.fixed` / `.sr-only`). So this test pins
 *                       the invariant ACROSS SURFACES rather than a fix: a
 *                       single-surface guard could pass while the shared shell
 *                       broke everywhere else.
 *   - `palette-drift` — "saturated background color rgb(58, 92, 161) not
 *                       resolvable to any DESIGN_SYSTEM token" on the
 *                       `settingsgen-accent-blue` swatch in dark mode: the
 *                       accent swatch painted its LIGHT variant while dark.
 */

async function seedConv(apiURL: string, token: string, title: string): Promise<string> {
  const res = await fetch(`${apiURL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`seed conv failed: ${res.status}`)
  return (await res.json()).id
}

/**
 * `hsl(H S% L%)` (or bare `H S% L%`) → `rgb(r, g, b)`, matching what
 * getComputedStyle reports for a background-color. The token is declared WITH
 * the `hsl()` wrapper in index.css, so the wrapper must be stripped before
 * parsing — reading it as bare channels yields NaN.
 */
function hslChannelsToRgb(raw: string): { r: number; g: number; b: number } {
  const channels = raw.trim().replace(/^hsla?\(/i, '').replace(/\)$/, '').replace(/[,/]/g, ' ')
  const [hRaw, sRaw, lRaw] = channels.trim().split(/\s+/)
  const h = parseFloat(hRaw)
  const s = parseFloat(sRaw) / 100
  const l = parseFloat(lRaw) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

/**
 * Measure horizontal overflow + viewport-clipped interactive controls on the
 * currently-rendered page. Mirrors the live-ui-audit battery's own signals
 * ("body scrollWidth N > viewport 390", "interactive control clipped by
 * viewport edge") so a regression fails here the same way it fails there, and
 * names the WIDEST offending element so the failure is actionable.
 */
async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollLeft = 0
    const vw = document.documentElement.clientWidth
    const sx = window.scrollX

    // Slack, in px, before an element counts as crossing the viewport edge.
    // Sub-pixel layout and empty-state fillers routinely sit 1-2px past the
    // edge INSIDE a clipping ancestor (no page scroll, nothing visibly cut);
    // the real reports were 13px+ over. 4px keeps the guard meaningful without
    // that noise.
    const EDGE_SLACK = 4

    const describe = (el: Element) =>
      `${el.tagName}${el.id ? '#' + el.id : ''}${
        el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''
      }`

    let widest: string | null = null
    let widestRight = vw
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const right = r.right + sx
      if (right > widestRight) {
        widestRight = right
        widest = `${describe(el)} right=${Math.round(right)}px class="${String(
          (el as HTMLElement).className ?? '',
        ).slice(0, 80)}"`
      }
    }

    const clipped: string[] = []
    const SELECTOR = 'button, a[href], input, select, textarea, [role="button"]'
    for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const style = getComputedStyle(el)
      // Deliberately off-screen assistive affordances (the skip link) are not
      // "clipped controls".
      if (style.position === 'absolute' && r.width <= 2) continue
      const right = r.right + sx
      const left = r.left + sx
      if (right > vw + EDGE_SLACK || left < -EDGE_SLACK) {
        clipped.push(
          `${describe(el)} [${Math.round(left)}..${Math.round(right)}] "${(
            el.textContent ||
            el.getAttribute('aria-label') ||
            ''
          )
            .trim()
            .slice(0, 30)}"`,
        )
      }
    }

    return {
      vw,
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      clipped,
      widest,
    }
  })
}

test.describe('live-ui-audit UI conformance — regression guards', () => {
  test.describe('mobile 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('TEST-11: no surface has horizontal page scroll or a viewport-clipped control at 390px', async ({
      page,
      testInfra,
    }) => {
      const { baseURL, apiURL } = testInfra
      await loginAsAdmin(page, baseURL)
      const token = await getAdminToken(apiURL)
      const conversationId = await seedConv(apiURL, token, 'Mobile overflow guard')

      // A REPRESENTATIVE SWEEP, not one page. The reported overflow was
      // attributed to a shared shell container, so a single-surface guard could
      // pass while every other surface broke. These cover the shell in its main
      // shapes — chat (composer chrome), list pages, the hub grid, and the
      // widest admin tables/forms (the surfaces the sweep measured widest).
      const surfaces: [string, string][] = [
        ['chat', `/chat/${conversationId}`],
        ['conversations', '/chats'],
        ['projects', '/projects'],
        ['hub-models', '/hub/models'],
        ['settings-users', '/settings/users'],
        ['settings-user-groups', '/settings/user-groups'],
        ['settings-mcp-admin', '/settings/mcp-admin'],
        ['settings-voice', '/settings/voice'],
      ]

      const failures: string[] = []
      for (const [name, route] of surfaces) {
        await page.goto(`${baseURL}${route}`)
        await page.waitForLoadState('load')
        await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
        await page.waitForTimeout(2000)
        const g = await measure(page)
        if (g.bodyScrollWidth > g.vw || g.docScrollWidth > g.vw) {
          failures.push(
            `${name} (${route}): horizontal scroll — body ${g.bodyScrollWidth} / doc ${g.docScrollWidth} > viewport ${g.vw}; widest offender ${g.widest ?? 'n/a'}`,
          )
        }
        for (const c of g.clipped) failures.push(`${name} (${route}): clipped control ${c}`)
      }
      expect(failures, `390px responsive breaks:\n${failures.join('\n')}`).toEqual([])
    })
  })

  test('TEST-10: in dark mode the selected accent swatch paints the DARK variant (= the live --primary), not the light one', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    // Drive dark the way the app actually resolves it: the preference defaults
    // to `system`, and ThemeProvider resolves `system` via prefers-color-scheme
    // (same mechanism as tests/e2e/settings/theme-options.spec.ts). Writing a
    // localStorage key the app does not read would silently leave this LIGHT
    // and the guard would prove nothing.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(`${baseURL}/settings/general`)
    await page.waitForLoadState('load')

    const picker = byTestId(page, 'settingsgen-accent-picker')
    await expect(picker).toBeVisible({ timeout: 20000 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)

    const probe = async () =>
      page.evaluate(() => {
        const root = document.documentElement
        const isDark =
          root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
        const primary = getComputedStyle(root).getPropertyValue('--primary').trim()
        const swatches: Record<string, string> = {}
        let selected: string | null = null
        for (const el of Array.from(
          document.querySelectorAll('[data-testid^="settingsgen-accent-"]'),
        )) {
          const id = el.getAttribute('data-testid')!.replace('settingsgen-accent-', '')
          if (id === 'picker') continue
          swatches[id] = getComputedStyle(el).backgroundColor
          if (el.getAttribute('aria-pressed') === 'true') selected = id
        }
        return { isDark, primary, swatches, selected }
      })

    const dark = await probe()
    expect(dark.isDark, 'the settings page must be rendering in dark mode').toBeTruthy()
    expect(dark.selected, 'exactly one accent must be marked active').toBeTruthy()

    // The exact measured drift: rgb(58, 92, 161) is hsl(220 47% 43%), the LIGHT
    // blue --primary. No swatch may paint a light-mode variant while dark.
    expect(
      Object.entries(dark.swatches).filter(([, c]) => c === 'rgb(58, 92, 161)'),
      'a swatch is still painting the LIGHT blue accent in dark mode',
    ).toEqual([])

    // The SELECTED swatch must equal the live --primary token: it previews
    // exactly what selecting it installs.
    const darkPrimary = hslChannelsToRgb(dark.primary)
    expect(
      dark.swatches[dark.selected!],
      `the active swatch (${dark.selected}) must equal --primary ${dark.primary}; swatches: ${JSON.stringify(dark.swatches)}`,
    ).toBe(`rgb(${darkPrimary.r}, ${darkPrimary.g}, ${darkPrimary.b})`)

    // BOTH themes (the design promise is per-theme fidelity, not "dark works").
    // Flip to light and require the same identity — and that every swatch
    // actually CHANGED, which is exactly what the pre-fix code failed to do.
    await page.emulateMedia({ colorScheme: 'light' })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false)
    const light = await probe()
    const lightPrimary = hslChannelsToRgb(light.primary)
    expect(
      light.swatches[light.selected!],
      `the active swatch must equal the LIGHT --primary ${light.primary}`,
    ).toBe(`rgb(${lightPrimary.r}, ${lightPrimary.g}, ${lightPrimary.b})`)
    for (const [id, color] of Object.entries(light.swatches)) {
      expect(
        color,
        `swatch "${id}" painted the same colour in both themes — it is not theme-aware`,
      ).not.toBe(dark.swatches[id])
    }
  })
})
