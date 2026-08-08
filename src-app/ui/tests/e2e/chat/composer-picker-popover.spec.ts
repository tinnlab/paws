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

test.describe('Chat composer — picker popovers stay usable at scale', () => {
  test.describe.configure({ mode: 'serial' })

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

    // The last seeded assistant is reachable only by scrolling.
    const last = panel.getByRole('option', { name: names[names.length - 1] })
    await vp.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await expect(last).toBeVisible()
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

    const last = panel.getByRole('option', { name: names[names.length - 1] })
    await vp.evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await expect(last).toBeVisible()
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

    // INV-1 — the long name did NOT widen the panel, and the panel is within its cap.
    expect(
      withLong?.width ?? Number.POSITIVE_INFINITY,
      'panel width must stay within the declared cap',
    ).toBeLessThanOrEqual(MAX_PANEL_WIDTH + 1)
    expect(
      Math.round(withLong?.width ?? -1),
      'a long name must not widen the panel beyond the short-name width',
    ).toBeLessThanOrEqual(Math.round(shortOnly?.width ?? 0) + 1)

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
    const panel = await openPicker(page, 'assistant')

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
        }
      })
    }

    await byTestId(page, 'chat-input-add-btn').first().click()
    await byTestId(page, 'assistant-menu-trigger').click()
    const assistant = await contractOf('assistant')
    await page.keyboard.press('Escape')

    await byTestId(page, 'kb-menu-trigger').click()
    const kb = await contractOf('kb')

    // INV-4 — identical shell. A picker still carrying a bespoke popover would
    // differ on at least one of these.
    expect(assistant).toEqual(kb)
    expect(assistant.combobox).toBe(1)
    expect(assistant.listbox).toBe(1)
    expect(assistant.overlayViewport).toBe(1)
    expect(assistant.options).toBe(true)
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

    // Multi-select: the "+" dropdown must STAY open so a second KB can be added.
    await expect(panel).toBeVisible()
    await panel.getByRole('combobox').fill('Multi KB Two')
    await expect(panel.getByRole('option')).toHaveCount(1)
    await byTestId(page, `kb-option-${created[1]}`).click()
    await expect(byTestId(page, `kb-chip-${created[1]}`)).toBeVisible()

    // Detach removes the chip.
    await byTestId(page, `kb-option-${created[1]}`).click()
    await expect(byTestId(page, `kb-chip-${created[1]}`)).toHaveCount(0)
    await expect(byTestId(page, `kb-chip-${created[0]}`)).toBeVisible()
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
        return {
          padding: `${s.paddingTop} ${s.paddingBottom}`,
          fontSize: getComputedStyle(el.querySelector('span:nth-of-type(2)') ?? el).fontSize,
          name: el.getAttribute('aria-label') ?? '',
        }
      })

    const assistant = await metrics('assistant-menu-trigger')
    const kb = await metrics('kb-menu-trigger')

    expect(assistant.padding, 'assistant row padding must match the KB row').toBe(kb.padding)
    expect(assistant.fontSize).toBe(kb.fontSize)
    // Every trigger carries an accessible name.
    expect(assistant.name.length).toBeGreaterThan(0)
    expect(kb.name.length).toBeGreaterThan(0)

    // …and they match the MCP item, which already used the shared PlusMenuItem row.
    const mcp = byTestId(page, 'chat-mcp-menu-item')
    if (await mcp.isVisible()) {
      const shared = await metrics('chat-mcp-menu-item')
      expect(assistant.padding, 'must match the pre-existing shared "+" row').toBe(shared.padding)
    }
  })
})
