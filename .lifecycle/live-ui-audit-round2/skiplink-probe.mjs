// Is the "Skip to content" bypass link ACTUALLY usable when focused?
// The audit reports it as a 1x1 interactive control; this measures what a
// keyboard user gets.
import { chromium } from '@playwright/test'

const BASE = process.argv.find(a => a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:1560'
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'password123' }),
})
const body = await login.json()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => {
  localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: t, user: u, isAuthenticated: true, expiresAt: Date.now() + 20 * 3600 * 1000 },
    version: 0,
  }))
}, [body.access_token ?? body.token, body.user])
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea', { timeout: 30000 })
await page.waitForTimeout(2000)

const read = async label => {
  const r = await page.evaluate(() => {
    const a = document.querySelector('a[href="#main-content"]')
    if (!a) return null
    const cs = getComputedStyle(a)
    const b = a.getBoundingClientRect()
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      pos: cs.position, clip: cs.clipPath, clipLegacy: cs.clip,
      width: cs.width, height: cs.height, overflow: cs.overflow,
      focused: document.activeElement === a,
      cls: a.className,
    }
  })
  console.log(label, JSON.stringify(r, null, 1))
}
await read('AT REST:')
await page.evaluate(() => document.querySelector('a[href="#main-content"]')?.focus())
await page.waitForTimeout(300)
await read('FOCUSED (programmatic):')
await page.evaluate(() => (document.activeElement)?.blur())
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
await read('FOCUSED (Tab):')
console.log('main-content tabindex:', await page.evaluate(() => document.querySelector('#main-content')?.getAttribute('tabindex')))
await browser.close()
