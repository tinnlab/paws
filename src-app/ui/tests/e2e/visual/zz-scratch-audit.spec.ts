import { test, expect, type Page, type Locator } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const LOADER_FAILURE = /failed to load module|Failed to fetch dynamically imported module|EMFILE/i
async function gotoUntilVisible(page: Page, url: string, target: Locator) {
  let last: unknown
  for (let a = 0; a < 5; a++) {
    let bad = false
    const onC = (m: { text(): string }) => { if (LOADER_FAILURE.test(m.text())) bad = true }
    page.on('console', onC)
    try {
      await page.goto(url)
      await target.waitFor({ state: 'visible', timeout: 25_000 })
      return
    } catch (e) {
      last = e
      const un = bad || (await page.getByText('Unknown content type').count().catch(() => 0)) > 0
      if (!un) { /* retry anyway in scratch */ }
    } finally { page.off('console', onC) }
  }
  throw last
}

async function open(page: Page, surface: string, theme = 'light') {
  await gotoUntilVisible(page, `/gallery.html?surface=${surface}&theme=${theme}`, page.locator('[data-slot="card-actions"]').first())
}

const IDS = ['tool-approval-deny', 'tool-approval-approve-once', 'tool-approval-approve-conv']

async function snap(card: Locator, ids: string[]) {
  return card.evaluate((root, list) => {
    const out: Record<string, any> = {}
    for (const id of list) {
      const el = root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
      if (!el) { out[id] = null; continue }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const clip = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }
      for (let p = el.parentElement; p; p = p.parentElement) {
        const pcs = getComputedStyle(p); const pr = p.getBoundingClientRect()
        if (pcs.overflowX === 'hidden' || pcs.overflowX === 'clip') { clip.l = Math.max(clip.l, pr.left); clip.r = Math.min(clip.r, pr.right) }
        if (pcs.overflowY === 'hidden' || pcs.overflowY === 'clip') { clip.t = Math.max(clip.t, pr.top); clip.b = Math.min(clip.b, pr.bottom) }
      }
      out[id] = {
        w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top),
        visW: Math.round(Math.max(0, Math.min(r.right, clip.r) - Math.max(r.left, clip.l))),
        visH: Math.round(Math.max(0, Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t))),
        overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak, whiteSpace: cs.whiteSpace,
        height: cs.height, minHeight: cs.minHeight, maxWidth: cs.maxWidth, flexShrink: cs.flexShrink,
        scrollW: el.scrollWidth, clientW: el.clientWidth, textAlign: cs.textAlign, paddingTop: cs.paddingTop,
      }
    }
    return out
  }, ids)
}

test('S1: approval geometry at multiple widths + computed child rules', async ({ page }) => {
  for (const vw of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width: vw, height: 900 })
    await open(page, 'deep-chat-tool-approval')
    const card = page.getByTestId('mcp-tool-approval-card').first()
    await card.scrollIntoViewIfNeeded()
    const row = card.locator('[data-slot="card-actions"]').first()
    const rowInfo = await row.evaluate(el => ({
      flexWrap: getComputedStyle(el).flexWrap,
      justify: getComputedStyle(el).justifyContent,
      clientW: el.clientWidth, scrollW: el.scrollWidth,
      gap: getComputedStyle(el).gap,
    }))
    const s = await snap(card, IDS)
    console.log(`\n== vw=${vw} row=${JSON.stringify(rowInfo)}`)
    for (const id of IDS) console.log(`   ${id}: ${JSON.stringify(s[id])}`)
  }
})

test('S2: header row / tool name with attacker-controlled long name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page, 'deep-chat-tool-approval')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.scrollIntoViewIfNeeded()
  const before = await card.evaluate(root => {
    const el = root.querySelector('[data-slot="card-content"] div div') as HTMLElement
    return el?.className
  })
  console.log('header classes probe:', before)
  const nameInfo = async () => card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    const name = hdr?.children[1] as HTMLElement
    const r = name.getBoundingClientRect()
    const hr = hdr.getBoundingClientRect()
    return {
      text: name.textContent,
      w: Math.round(r.width), scrollW: name.scrollWidth, clientW: name.clientWidth,
      title: name.getAttribute('title'),
      headerW: Math.round(hr.width), headerScrollW: hdr.scrollWidth,
      lines: Array.from(hdr.children).map(c => Math.round(c.getBoundingClientRect().top)),
      cs: getComputedStyle(name).textOverflow + '/' + getComputedStyle(name).overflow,
    }
  })
  console.log('DEFAULT name:', JSON.stringify(await nameInfo()))

  // attacker-chosen long tool name
  await card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    const name = hdr.children[1] as HTMLElement
    name.textContent = 'get_forecast_safe_readonly_public_data_only_and_then_delete_all_user_files'
    name.setAttribute('title', name.textContent)
  })
  console.log('LONG name:', JSON.stringify(await nameInfo()))

  // attacker-chosen long SERVER label
  await card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    const name = hdr.children[1] as HTMLElement
    name.textContent = 'get_forecast'
    const srv = hdr.children[2] as HTMLElement
    srv.textContent = '(Acme Weather Corporation International Holdings Limited Servers)'
  })
  console.log('LONG server:', JSON.stringify(await nameInfo()))
})

test('S3: RTL behaviour of the action row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page, 'deep-chat-tool-approval')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.evaluate(() => { document.documentElement.setAttribute('dir', 'rtl') })
  await page.waitForTimeout(300)
  await card.scrollIntoViewIfNeeded()
  const s = await snap(card, IDS)
  console.log('RTL 390:', JSON.stringify(s, null, 1))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(300)
  const s2 = await snap(card, IDS)
  console.log('RTL 1280:', JSON.stringify(s2, null, 1))
})

test('S4: does the fix actually beat a simulated regression? (revert CardActions via CSS)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page, 'deep-chat-tool-approval')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.scrollIntoViewIfNeeded()
  await page.addStyleTag({ content: `
    [data-slot="card-actions"] { flex-wrap: nowrap !important; }
    [data-slot="card-actions"] > button { height: 2rem !important; min-height: 0 !important; max-width: none !important; white-space: nowrap !important; overflow-wrap: normal !important; padding-top:0 !important; padding-bottom:0 !important; }
  `})
  await page.waitForTimeout(300)
  const s = await snap(card, IDS)
  console.log('SIMULATED-BROKEN 390:', JSON.stringify(s, null, 1))
  const row = card.locator('[data-slot="card-actions"]').first()
  console.log('row', JSON.stringify(await row.evaluate(el => ({ c: el.clientWidth, s: el.scrollWidth }))))
  // Would expectPressable fail?
  let err = ''
  try {
    await card.getByTestId('tool-approval-deny').first().click({ trial: true, timeout: 3000 })
  } catch (e) { err = String(e).slice(0, 200) }
  console.log('trial click deny under broken CSS ->', err || 'PASSED (bad!)')
})

test('S5: over-wide single action wraps inside the button (unbroken token)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page, 'deep-chat-tool-approval')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.scrollIntoViewIfNeeded()
  await card.evaluate(root => {
    const b = root.querySelector('[data-testid="tool-approval-approve-conv"]') as HTMLElement
    // put the long token in the text node, not replacing children (icon stays)
    b.childNodes[b.childNodes.length - 1].textContent = 'Genehmigungsanfragefuerdiesekonversationbestaetigenundfortfahren'
  })
  await page.waitForTimeout(200)
  const s = await snap(card, IDS)
  console.log('UNBROKEN TOKEN:', JSON.stringify(s, null, 1))
})

test('S6: elicitation + wizard surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  for (const surf of ['deep-chat-elicitation', 'deep-chat-elicitation-no-fields', 'deep-chat-ask-user-wizard']) {
    try {
      await open(page, surf)
      const info = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-slot="card-actions"]'))
        return {
          nRows: rows.length,
          testids: rows.map(r => Array.from(r.children).map(c => c.getAttribute('data-testid') || c.tagName)),
          noFieldsCard: document.querySelectorAll('[data-testid="mcp-elicitation-no-fields-card"]').length,
          acceptNoValues: document.querySelectorAll('[data-testid="elicitation-accept-no-values"]').length,
        }
      })
      console.log(`${surf}:`, JSON.stringify(info))
    } catch (e) { console.log(`${surf}: FAILED ${String(e).slice(0,120)}`) }
  }
})

test('S7: narrow container 260 at 1280 + card overflow chain', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, 'deep-chat-tool-approval')
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.evaluate(el => { (el as HTMLElement).style.width = '260px'; (el as HTMLElement).style.maxWidth = '260px' })
  await page.waitForTimeout(200)
  const s = await snap(card, IDS)
  console.log('260px container:', JSON.stringify(s, null, 1))
  // Also 200px, and 150px
  for (const w of ['200px', '150px']) {
    await card.evaluate((el, ww) => { (el as HTMLElement).style.width = ww; (el as HTMLElement).style.maxWidth = ww }, w)
    await page.waitForTimeout(150)
    console.log(`${w} container:`, JSON.stringify(await snap(card, IDS), null, 1))
  }
})
