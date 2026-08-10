import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'

/**
 * E2E — the app must never present a persistently EMPTY document, and no render
 * throw may escape into the shell's boundary during normal use (INV-2).
 *
 * ## The defect
 *
 * A Rules-of-Hooks violation in `ChatMessage` threw during render. The throw was
 * caught by `AppShell`'s per-module `AppErrorBoundary` around the ROUTER module —
 * whose fallback was `() => null`. Because the router renders the entire routed
 * app, "isolate the module" became "render nothing at all":
 * `document.body.innerText.length === 0`, no message, no way back. A boundary
 * latches, so it stayed dead; the explorer log shows four subsequent navigations
 * all landing on the same empty surface.
 *
 * ## Honest scope — what this proves, and what it CANNOT
 *
 * The original crash needed a specific data state (an answerless assistant turn
 * whose `interrupted`/`finalizing` flag flips on a mounted `ChatMessage`). This
 * suite does not seed a real LLM turn, so it cannot recreate that exact state —
 * and a spec that merely `page.goto()`s a few routes and asserts "body is not
 * empty" would pass on the BROKEN app, since a crashing router now renders the
 * fallback text. An earlier draft of this file did exactly that and was worthless.
 *
 * So this spec asserts the two things it genuinely can, in a real browser against
 * the real bundle:
 *
 *   1. **No boundary catch, ever.** It fails on any `[AppErrorBoundary …]`
 *      console error or React error #300/#310 ("Rendered fewer/more hooks…").
 *
 *      MEASURED LIMIT — this spec does NOT catch the original defect, and the
 *      claim that it does was checked rather than assumed: with the `ChatMessage`
 *      fix reverted, this spec still PASSES (verified, full run). The reason is
 *      (2) above — a fresh test database contains no answerless assistant turn,
 *      so the crashing state is never rendered. Treat this as a general guard
 *      against ANY render crash reaching the shell during ordinary navigation,
 *      NOT as the regression test for the hook bug. That regression test is
 *      `src/modules/chat/components/ChatMessage.hooks.test.tsx`, which was
 *      verified RED 4/4 with the exact production error.
 *   2. **Never a persistently blank document**, using genuine CLIENT-SIDE
 *      navigation (in-app link clicks — a `page.goto()` is a full document
 *      reboot and structurally cannot reproduce a re-render-driven crash).
 *
 * The containment MECHANISM (a caught crash renders a visible `role="alert"`
 * with recovery affordances instead of `null`, siblings keep rendering, and the
 * latch clears on navigation) is proven deterministically in
 * `src/modules/shell/AppShellErrorContainment.test.tsx`, verified RED 4/4 against
 * the previous `fallback={() => null}`. This spec is its real-browser complement,
 * not a replacement.
 */

/** Nav entries reachable from the app shell, by accessible name. */
const NAV = [/^Chats$/, /^Projects$/, /^Knowledge$/, /^Chats$/]

/** Body text length after letting the SPA settle (the detector's rule). */
async function settledBodyLength(page: import('@playwright/test').Page) {
  await page
    .waitForLoadState('networkidle', { timeout: 5000 })
    .catch(() => undefined)
  await page.waitForTimeout(750)
  return page.evaluate(() => document.body.innerText.trim().length)
}

/**
 * Collect render-crash evidence. `AppErrorBoundary.componentDidCatch` logs
 * unconditionally (deliberately — auto-recovery must not hide a crash), so a
 * caught throw is always observable here even when the UI recovers.
 */
function watchForRenderCrashes(page: import('@playwright/test').Page) {
  const crashes: string[] = []
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (
      t.includes('[AppErrorBoundary') ||
      /Minified React error #(300|310)/.test(t) ||
      /Rendered (fewer|more) hooks/.test(t)
    ) {
      crashes.push(t.slice(0, 400))
    }
  })
  page.on('pageerror', e => {
    if (/Rendered (fewer|more) hooks|Minified React error #(300|310)/.test(e.message)) {
      crashes.push(e.message.slice(0, 400))
    }
  })
  return crashes
}

test.describe('Shell — no render crash, no blank document', () => {
  test('client-side navigation never crashes a render nor blanks the document', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    const crashes = watchForRenderCrashes(page)

    await loginAsAdmin(page, baseURL)
    await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })

    // Positive control: the app really rendered before we assert anything about
    // it. Without this every assertion below could pass on a page that never
    // worked, and the whole spec would be vacuous.
    expect(
      await settledBodyLength(page),
      'the app never rendered — every later assertion would be vacuous',
    ).toBeGreaterThan(0)

    // Genuine CLIENT-SIDE navigation: click the shell's own nav entries, which
    // keeps the React tree mounted and re-renders it — the condition a
    // re-render-driven hook crash needs. A `page.goto` would reboot the tree.
    for (const name of NAV) {
      const link = page.getByRole('link', { name }).first()
      if ((await link.count()) === 0) continue
      await link.click({ timeout: 10000 }).catch(() => undefined)
      // Fast cadence, matching the live reproduction that found the bug.
      await page.waitForTimeout(250)

      // A blank frame DURING a transition is normal; one that persists is the bug.
      const len = await page.evaluate(() =>
        document.body.innerText.trim().length,
      )
      if (len === 0) {
        expect(
          await settledBodyLength(page),
          'document stayed blank after a client-side navigation',
        ).toBeGreaterThan(0)
      }
    }

    // The load-bearing assertion: nothing threw into the shell's boundary during
    // ordinary navigation. See the MEASURED LIMIT in the header — this does not
    // trip for the original hook bug, whose data state this suite does not seed.
    expect(crashes, `render crash(es) escaped into the shell:\n${crashes.join('\n')}`)
      .toHaveLength(0)

    // …and the app is still interactive, not a latched-dead shell.
    await page.goto(`${baseURL}/settings/profile`, {
      waitUntil: 'domcontentloaded',
    })
    expect(await settledBodyLength(page)).toBeGreaterThan(0)
  })
})
