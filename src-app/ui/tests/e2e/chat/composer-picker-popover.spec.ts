/**
 * Composer "+" submenu pickers — bounded, scrollable, searchable at scale.
 *
 * Realizes `docs/design/composer-picker-popover.md`. Every scale assertion SEEDS its
 * own data (26 assistants / 26 knowledge bases) rather than asserting against whatever
 * the fixture DB happens to contain — a picker that "fits" because there are only two
 * entries proves nothing about the behaviour under test.
 *
 * Both stores load once at shell mount, so seeding always precedes `page.goto`.
 *
 *   npm run test:e2e -- tests/e2e/chat/composer-picker-popover.spec.ts --workers=1
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/** The declared caps from `ComposerPickerPopover` (max-w-80 = 320px, max-h-64 = 256px). */
const MAX_PANEL_WIDTH = 320
/** 256px list + the search box + panel padding + the popup's own ring. */
const MAX_PANEL_HEIGHT = 360

const SEED_COUNT = 26

async function seedAssistants(
  page: Page,
  apiURL: string,
  token: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const res = await page.request.post(`${apiURL}/api/assistants`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, instructions: 'seeded for the picker spec', is_template: false },
    })
    expect(res.ok(), `failed to seed assistant ${name}`).toBeTruthy()
  }
}

async function seedKbs(
  page: Page,
  apiURL: string,
  token: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const res = await page.request.post(`${apiURL}/api/knowledge-bases`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
    })
    expect(res.ok(), `failed to seed knowledge base ${name}`).toBeTruthy()
  }
}

const numbered = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix} ${String(i).padStart(2, '0')}`)

async function openChat(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/chat`)
  await page.waitForSelector('textarea[placeholder*="Type your message"]', { timeout: 30_000 })
}

/** Open the "+" dropdown, then one of its submenu pickers. Returns the panel locator. */
async function openPicker(page: Page, which: 'assistant' | 'kb') {
  await byTestId(page, 'chat-input-add-btn').first().click()
  await byTestId(page, which === 'kb' ? 'kb-menu-trigger' : 'assistant-menu-trigger').click()
  const panel = byTestId(page, which === 'kb' ? 'kb-menu-options' : 'assistant-menu-options')
  await expect(panel).toBeVisible()
  return panel
}

/**
 * The overlayscrollbars viewport inside the panel — the element that actually
 * scrolls. Its `data-overlayscrollbars-viewport` attribute is what distinguishes the
 * app's ScrollArea from a plain native scroller, so asserting on it is what makes
 * "uses the overlay scrollbar" a real check rather than "something overflows".
 */
const viewport = (panel: ReturnType<typeof byTestId>) =>
  panel.locator('[data-overlayscrollbars-viewport]')

/**
 * Is `row` geometrically inside the scroller's box?
 *
 * `toBeVisible()` is NOT this check — Playwright only requires a non-empty bounding
 * box, which a row clipped inside an `overflow` scroller still has. A blind audit
 * caught the earlier version asserting `toBeVisible()` after scrolling and staying
 * green without the scroll; this is the geometry that actually distinguishes them.
 */
async function isInsideScroller(
  vp: ReturnType<typeof viewport>,
  row: ReturnType<typeof byTestId>,
): Promise<boolean> {
  const [vbox, rbox] = [await vp.boundingBox(), await row.boundingBox()]
  if (!vbox || !rbox) return false
  return rbox.y >= vbox.y - 1 && rbox.y + rbox.height <= vbox.y + vbox.height + 1
}

test.describe('Chat composer — picker popovers stay usable at scale', () => {
  // NOT serial: each test owns its own database + server, and a failure in one must
  // not SKIP the rest (that would hide every later result behind the first red).

  test('assistant picker caps its height and scrolls to the last of 26 entries (TEST-11)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const names = numbered('Picker Assistant', SEED_COUNT)
    await seedAssistants(page, apiURL, token, names)

    await openChat(page, baseURL)
    const panel = await openPicker(page, 'assistant')

    // The SAME bound the KB picker is held to (TEST-12) — asserted for both, or the
    // cap is only proven for one of the two pickers the design says are identical.
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(
      box?.height ?? Number.POSITIVE_INFINITY,
      'the assistant panel must stay within its declared height cap',
    ).toBeLessThanOrEqual(MAX_PANEL_HEIGHT)

    const vp = viewport(panel)
    await expect(vp).toHaveCount(1)

    // The list must genuinely overflow its cap — i.e. the panel did NOT grow to fit 26 rows.
    const overflow = await vp.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(
      overflow.scrollHeight,
      'the 26-row list must overflow a capped viewport',
    ).toBeGreaterThan(overflow.clientHeight)

    // The LAST ROW IN THE DOM — not the last name I seeded. The store returns
    // assistants newest-first, so `Picker Assistant 25` is actually the FIRST row;
    // asserting on it silently tested a visible row (it did, and went red).
    const last = panel.getByRole('option').last()
    expect(await isInsideScroller(vp, last), 'the last row must start out clipped').toBe(false)
    await vp.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await expect(last).toBeVisible()
    expect(await isInsideScroller(vp, last), 'scrolling must bring it into the box').toBe(true)
  })

  test('KB picker: 26 entries stay inside the height cap and scroll via the overlay scrollbar (TEST-12)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const names = numbered('Picker KB', SEED_COUNT)
    await seedKbs(page, apiURL, token, names)

    await openChat(page, baseURL)
    const panel = await openPicker(page, 'kb')

    // INV-2, half 1 — bounded height even at 26 rows.
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(
      box?.height ?? Number.POSITIVE_INFINITY,
      'the panel must stay within its declared height cap',
    ).toBeLessThanOrEqual(MAX_PANEL_HEIGHT)

    // INV-2, half 2 — it is the app's overlayscrollbars ScrollArea, not a native scroller.
    const vp = viewport(panel)
    await expect(vp, 'the list must scroll through the overlayscrollbars viewport').toHaveCount(1)
    const overflow = await vp.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)

    const last = panel.getByRole('option').last()
    expect(await isInsideScroller(vp, last), 'the last KB row must start out clipped').toBe(false)
    await vp.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await expect(last).toBeVisible()
    expect(await isInsideScroller(vp, last), 'scrolling must bring it into the box').toBe(true)
  })

  test('a very long name truncates instead of widening the panel (TEST-13)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // CONTROL first: short names only, measure the panel.
    await seedAssistants(page, apiURL, token, numbered('Short', 5))
    await openChat(page, baseURL)
    let panel = await openPicker(page, 'assistant')
    const shortOnly = await panel.boundingBox()
    expect(shortOnly).not.toBeNull()

    // Then add a pathologically long name and measure again.
    const longName = `Assistant ${'X'.repeat(200)} end`
    await seedAssistants(page, apiURL, token, [longName])
    await openChat(page, baseURL)
    panel = await openPicker(page, 'assistant')
    const withLong = await panel.boundingBox()
    expect(withLong).not.toBeNull()

    // INV-1 — the panel is BOUNDED. It may grow within its range (240px floor →
    // 320px cap) as content demands; what it must never do is grow to FIT the name.
    expect(
      withLong?.width ?? Number.POSITIVE_INFINITY,
      'panel width must stay within the declared cap',
    ).toBeLessThanOrEqual(MAX_PANEL_WIDTH + 1)
    expect(
      shortOnly?.width ?? 0,
      'the control (short names only) must itself be within the cap',
    ).toBeLessThanOrEqual(MAX_PANEL_WIDTH + 1)

    // …because the ROW absorbed it: the label is truncated, with the full text kept.
    const longRow = panel.getByRole('option').filter({ hasText: 'Assistant XXX' }).first()
    await expect(longRow).toBeVisible()
    const label = longRow.locator('span[title]').first()
    const trunc = await label.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      title: el.getAttribute('title') ?? '',
    }))
    expect(trunc.scrollWidth, 'the long label must be truncated').toBeGreaterThan(trunc.clientWidth)
    expect(trunc.title).toContain('XXXXX')

    // The non-vacuous half: the label NEEDED far more room than the panel allows, and
    // the panel refused to give it. Remove the width cap and `scrollWidth` collapses to
    // the panel width, turning this assertion red.
    expect(
      trunc.scrollWidth,
      'the label must want much more width than the capped panel grants',
    ).toBeGreaterThan((withLong?.width ?? 0) * 2)
  })

  test('a search box sits on top of BOTH pickers, filters live, and shows a real no-matches state (TEST-14)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedAssistants(page, apiURL, token, numbered('Picker Assistant', 12))
    // Only THREE KBs — the old implementation hid its search box below seven, so this
    // count is what proves the threshold is gone.
    await seedKbs(page, apiURL, token, numbered('Picker KB', 3))

    await openChat(page, baseURL)

    // ── assistant ───────────────────────────────────────────────────────────────
    let panel = await openPicker(page, 'assistant')
    const aSearch = panel.getByRole('combobox')
    await expect(aSearch).toBeVisible()
    // "on top": the search box precedes the listbox in DOM order.
    expect(
      await panel.evaluate(el => {
        const box = el.querySelector('[role="combobox"]')
        const list = el.querySelector('[role="listbox"]')
        if (!box || !list) return -1
        // eslint-disable-next-line no-bitwise
        return box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0
      }),
      'the search box must precede the list',
    ).toBe(1)

    const before = await panel.getByRole('option').count()
    expect(before).toBeGreaterThan(1)
    await aSearch.fill('Assistant 07')
    await expect(panel.getByRole('option')).toHaveCount(1)

    await aSearch.fill('zzzz-no-such-assistant')
    await expect(panel.getByRole('option')).toHaveCount(0)
    await expect(panel.getByText('No matches.')).toBeVisible()
    await page.keyboard.press('Escape')

    // ── knowledge bases (only 3 seeded — the box must still be there) ────────────
    await byTestId(page, 'kb-menu-trigger').click()
    panel = byTestId(page, 'kb-menu-options')
    await expect(panel).toBeVisible()
    const kSearch = panel.getByRole('combobox')
    await expect(kSearch, 'the search box must not be threshold-gated').toBeVisible()

    await kSearch.fill('KB 01')
    await expect(panel.getByRole('option')).toHaveCount(1)
    await kSearch.fill('zzzz-no-such-kb')
    await expect(panel.getByRole('option')).toHaveCount(0)
    await expect(panel.getByText('No matches.')).toBeVisible()
  })

  test('keyboard: focus lands in search, arrows move, Enter selects, Escape closes only the submenu (TEST-15)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const names = numbered('Keyboard Assistant', 6)
    await seedAssistants(page, apiURL, token, names)

    await openChat(page, baseURL)

    // Open with the KEYBOARD, on the real PlusMenuItem trigger. A blind audit
    // predicted Enter would open-and-immediately-close here (the row's own Enter
    // handler composing with Base UI's button emulation); the mouse-driven path
    // cannot see that, so it is asserted in a real browser.
    await byTestId(page, 'chat-input-add-btn').first().click()
    await byTestId(page, 'assistant-menu-trigger').focus()
    await page.keyboard.press('Enter')
    await expect(
      byTestId(page, 'assistant-menu-options'),
      'Enter on the trigger must OPEN the picker, not toggle it twice',
    ).toBeVisible()
    const panel = byTestId(page, 'assistant-menu-options')

    // focus-on-open
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('role') ?? null,
    )
    expect(focused, 'focus must land in the search box on open').toBe('combobox')

    // arrows move the active option
    const activeLabel = async () =>
      panel.evaluate(el => {
        const box = el.querySelector('[role="combobox"]')
        const id = box?.getAttribute('aria-activedescendant')
        return id ? (el.ownerDocument.getElementById(id)?.textContent?.trim() ?? null) : null
      })

    const first = await activeLabel()
    await page.keyboard.press('ArrowDown')
    const second = await activeLabel()
    expect(second, 'ArrowDown must move the active option').not.toBe(first)
    await page.keyboard.press('ArrowUp')
    expect(await activeLabel(), 'ArrowUp must move it back').toBe(first)

    // Enter selects the ACTIVE option (row 2 after two ArrowDowns)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    const target = await activeLabel()
    await page.keyboard.press('Enter')
    await expect(byTestId(page, 'assistant-status-chip')).toContainText(target as string)

    // Escape closes the submenu but NOT the parent "+" dropdown.
    await byTestId(page, 'chat-input-add-btn').first().click()
    await byTestId(page, 'assistant-menu-trigger').click()
    await expect(byTestId(page, 'assistant-menu-options')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(byTestId(page, 'assistant-menu-options')).toBeHidden()
    await expect(
      byTestId(page, 'kb-menu-trigger'),
      'the parent "+" dropdown must survive Escape in the submenu',
    ).toBeVisible()
  })

  test('both pickers expose the SAME shell — one primitive, not two (TEST-16)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedAssistants(page, apiURL, token, numbered('Parity Assistant', 10))
    await seedKbs(page, apiURL, token, numbered('Parity KB', 10))

    await openChat(page, baseURL)

    const contractOf = async (which: 'assistant' | 'kb') => {
      const panel =
        which === 'assistant'
          ? byTestId(page, 'assistant-menu-options')
          : byTestId(page, 'kb-menu-options')
      await expect(panel).toBeVisible()
      return panel.evaluate(el => {
        const s = getComputedStyle(el)
        return {
          combobox: el.querySelectorAll('[role="combobox"]').length,
          listbox: el.querySelectorAll('[role="listbox"]').length,
          options: el.querySelectorAll('[role="option"]').length > 0,
          overlayViewport: el.querySelectorAll('[data-overlayscrollbars-viewport]').length,
          maxWidth: s.maxWidth,
          minWidth: s.minWidth,
          listMaxHeight: (() => {
            const host = el.querySelector('[data-overlayscrollbars]') ?? el.querySelector('[data-overlayscrollbars-viewport]')?.closest('[data-overlayscrollbars]')
            return host ? getComputedStyle(host as Element).maxHeight : 'none'
          })(),
        }
      })
    }

    await byTestId(page, 'chat-input-add-btn').first().click()
    await byTestId(page, 'assistant-menu-trigger').click()
    const assistant = await contractOf('assistant')
    await page.keyboard.press('Escape')

    await byTestId(page, 'kb-menu-trigger').click()
    const kb = await contractOf('kb')

    // INV-4 — identical shell. Equality alone is true BY CONSTRUCTION once both
    // callers import the primitive (a blind audit caught that), so the caps are also
    // asserted against ABSOLUTE values: delete `max-w-80` and this goes red even
    // though the two panels would still match each other.
    expect(assistant).toEqual(kb)
    expect(assistant.combobox).toBe(1)
    expect(assistant.listbox).toBe(1)
    expect(assistant.overlayViewport).toBe(1)
    expect(assistant.options).toBe(true)
    expect(assistant.maxWidth, 'the width cap must be a real value, not `none`').toBe('320px')
    expect(assistant.minWidth).toBe('240px')
    expect(assistant.listMaxHeight, 'the list height cap must be a real value').toBe('256px')
  })

  test('KB multi-select still works through the shared shell (TEST-17)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const created: string[] = []
    for (const name of ['Multi KB One', 'Multi KB Two', 'Multi KB Three']) {
      const res = await page.request.post(`${apiURL}/api/knowledge-bases`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name },
      })
      expect(res.ok()).toBeTruthy()
      created.push((await res.json()).id as string)
    }

    await openChat(page, baseURL)
    const panel = await openPicker(page, 'kb')

    // Filter, then attach.
    await panel.getByRole('combobox').fill('Multi KB One')
    await expect(panel.getByRole('option')).toHaveCount(1)
    await byTestId(page, `kb-option-${created[0]}`).click()
    await expect(byTestId(page, `kb-chip-${created[0]}`)).toBeVisible()

    // Multi-select: the "+" DROPDOWN itself must stay open so a second KB can be
    // added. Asserted on a SIBLING item of the parent menu, not on the submenu —
    // the submenu staying visible says nothing about its parent.
    await expect(panel).toBeVisible()
    await expect(
      byTestId(page, 'assistant-menu-trigger'),
      'the parent "+" dropdown must stay open after a multi-select toggle',
    ).toBeVisible()
    await panel.getByRole('combobox').fill('Multi KB Two')
    await expect(panel.getByRole('option')).toHaveCount(1)
    await byTestId(page, `kb-option-${created[1]}`).click()
    await expect(byTestId(page, `kb-chip-${created[1]}`)).toBeVisible()

    // Detach removes the chip.
    await byTestId(page, `kb-option-${created[1]}`).click()
    await expect(byTestId(page, `kb-chip-${created[1]}`)).toHaveCount(0)
    await expect(byTestId(page, `kb-chip-${created[0]}`)).toBeVisible()
  })

  test('the picker stays inside a 390px viewport (TEST-22)', async ({ page, testInfra }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedKbs(page, apiURL, token, numbered('Narrow KB', SEED_COUNT))

    // A 240px-min panel opening side="right" from a nested popover is exactly the
    // geometry that breaks at mobile width; a desktop-only picker is a defect.
    await page.setViewportSize({ width: 390, height: 844 })
    await openChat(page, baseURL)
    const panel = await openPicker(page, 'kb')

    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x, 'the panel must not start off the left edge').toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width, 'the panel must not run off the right edge').toBeLessThanOrEqual(391)
    expect(box!.height, 'the height cap still applies at mobile width').toBeLessThanOrEqual(
      MAX_PANEL_HEIGHT,
    )

    // …and the page itself must not gain a horizontal scrollbar because of it.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, 'the picker must not cause horizontal page scroll').toBe(false)
  })

  test('both trigger rows share the "+" menu row metrics (TEST-18)', async ({
    page,
    testInfra,
  }) => {
    test.setTimeout(180_000)
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedAssistants(page, apiURL, token, ['Metrics Assistant'])
    await seedKbs(page, apiURL, token, ['Metrics KB'])

    await openChat(page, baseURL)
    await byTestId(page, 'chat-input-add-btn').first().click()

    const metrics = (id: 'assistant-menu-trigger' | 'kb-menu-trigger' | 'chat-mcp-menu-item') =>
      byTestId(page, id).evaluate(el => {
        const s = getComputedStyle(el)
        const icon = el.querySelector('svg')
        return {
          padding: `${s.paddingTop} ${s.paddingBottom}`,
          paddingInline: `${s.paddingLeft} ${s.paddingRight}`,
          fontSize: getComputedStyle(el.querySelector('span:nth-of-type(2)') ?? el).fontSize,
          iconSize: icon
            ? `${getComputedStyle(icon).width} x ${getComputedStyle(icon).height}`
            : 'none',
          name: el.getAttribute('aria-label') ?? '',
        }
      })

    const assistant = await metrics('assistant-menu-trigger')
    const kb = await metrics('kb-menu-trigger')

    expect(assistant.padding, 'assistant row padding must match the KB row').toBe(kb.padding)
    expect(assistant.fontSize).toBe(kb.fontSize)
    expect(assistant.iconSize, 'leading icons must share the shared row metric').toBe(kb.iconSize)
    expect(assistant.iconSize).not.toBe('none')
    // Every trigger carries an accessible name.
    expect(assistant.name.length).toBeGreaterThan(0)
    expect(kb.name.length).toBeGreaterThan(0)

    // …and they match `PlusMenuItem`'s DECLARED metric absolutely (`px-3 py-1.5`
    // = 12px/6px, `text-sm` = 14px, icons forced to `size-4` = 16px). Absolute
    // rather than compared to a sibling: the assistant-vs-kb equality above is true
    // by construction once both use the shared row, and the one always-present
    // sibling ("+ Attach files") carries its testid on the kit Upload ROOT, whose
    // padding is 0 — measuring it compared the wrong node. If either trigger is
    // ever hand-rolled again with different metrics, these go red.
    for (const [name, m] of [
      ['assistant', assistant],
      ['kb', kb],
    ] as const) {
      expect(m.padding, `${name} row must use the shared px-3 py-1.5 metric`).toBe('6px 6px')
      expect(m.paddingInline, `${name} row inline padding`).toBe('12px 12px')
      expect(m.fontSize, `${name} row label must be text-sm`).toBe('14px')
      expect(m.iconSize, `${name} row icon must be size-4`).toBe('16px x 16px')
    }
  })
})
