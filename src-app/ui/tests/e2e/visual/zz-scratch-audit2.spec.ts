import { test, type Page, type Locator } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

async function gotoUntilVisible(page: Page, url: string, target: Locator) {
  let last: unknown
  for (let a = 0; a < 5; a++) {
    try { await page.goto(url); await target.waitFor({ state: 'visible', timeout: 25_000 }); return }
    catch (e) { last = e }
  }
  throw last
}

test('A: server label clipping + tool-name truncation reachability', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await gotoUntilVisible(page, '/gallery.html?surface=deep-chat-tool-approval&theme=light', page.locator('[data-slot="card-actions"]').first())
  const card = page.getByTestId('mcp-tool-approval-card').first()
  await card.scrollIntoViewIfNeeded()

  const probe = () => card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    const measure = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const clip = { l: -Infinity, r: Infinity }
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p); const pr = p.getBoundingClientRect()
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') { clip.l = Math.max(clip.l, pr.left); clip.r = Math.min(clip.r, pr.right) }
      }
      return { text: (el.textContent || '').slice(0, 60), w: Math.round(r.width),
        visW: Math.round(Math.max(0, Math.min(r.right, clip.r) - Math.max(r.left, clip.l))),
        scrollW: el.scrollWidth, ws: getComputedStyle(el).whiteSpace, ov: getComputedStyle(el).overflow }
    }
    return Array.from(hdr.children).map(c => measure(c as HTMLElement))
  })

  console.log('BASE header:', JSON.stringify(await probe()))

  await card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    ;(hdr.children[2] as HTMLElement).textContent = '(Acme Weather Official Verified Trusted Server evil.example.com)'
  })
  await page.waitForTimeout(150)
  console.log('LONG SERVER header:', JSON.stringify(await probe()))

  await card.evaluate(root => {
    const hdr = root.querySelector('.flex.flex-wrap.items-center') as HTMLElement
    ;(hdr.children[2] as HTMLElement).textContent = '(Acme Weather)'
    ;(hdr.children[1] as HTMLElement).textContent = 'get_weather_forecast_readonly_public_safe_then_delete_everything'
  })
  await page.waitForTimeout(150)
  console.log('LONG NAME header:', JSON.stringify(await probe()))
})

test('B: unbroken-token DESCRIPTION really cannot hide text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await gotoUntilVisible(page, '/gallery.html?surface=deep-chat-tool-approval-long-desc&theme=light', page.getByTestId('approval-tool-description'))
  const desc = page.getByTestId('approval-tool-description').first()
  console.log('BASE desc:', JSON.stringify(await desc.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, ow: getComputedStyle(el).overflowWrap, wb: getComputedStyle(el).wordBreak, h: el.scrollHeight }))))
  await desc.evaluate(el => { el.textContent = 'A'.repeat(4000) })
  await page.waitForTimeout(200)
  console.log('UNBROKEN desc:', JSON.stringify(await desc.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.scrollHeight }))))
  const region = page.getByTestId('collapsible-content').first()
  console.log('region:', JSON.stringify(await region.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight }))))
  console.log('toggle count:', await page.getByTestId('collapsible-toggle').count())
})

test('C: run_js approval surface presence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const surfaces = ['deep-chat-run-js-approval', 'deep-chat-js-tool-approval']
  for (const s of surfaces) {
    await page.goto(`/gallery.html?surface=${s}&theme=light`).catch(() => {})
    await page.waitForTimeout(1500)
    console.log(s, 'alerts:', await page.locator('[data-testid^="run-js-approval-alert-"]').count())
  }
})
