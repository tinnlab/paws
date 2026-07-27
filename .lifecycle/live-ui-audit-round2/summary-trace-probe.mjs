// Trace WHO issues `GET /api/conversations/{id}/summary` during a send, by
// wrapping `fetch` in the page and capturing a JS stack per call. Used to find
// the last duplicate the audit kept reporting.
import { chromium } from '@playwright/test'

const BASE = process.argv.find(a => a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:1560'

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'password123' }),
})
const body = await login.json()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => {
  localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: t, user: u, isAuthenticated: true, expiresAt: Date.now() + 20 * 3600 * 1000 },
    version: 0,
  }))
  const orig = window.fetch
  ;(window).__summaryCalls = []
  window.fetch = function (...args) {
    const url = String(args[0] && (args[0].url ?? args[0]))
    if (/\/summary(\?|$)/.test(url) || /\/memories(\?|$)/.test(url) || /background\/runs/.test(url)) {
      ;(window).__summaryCalls.push(
        `${Date.now()} ${url}\n${new Error('trace').stack}`,
      )
    }
    return orig.apply(this, args)
  }
}, [body.access_token ?? body.token, body.user])

page.on('console', m => {
  const t = m.text()
  if (/summary|Summariz/i.test(t)) console.log('[console]', t.slice(0, 200))
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea', { timeout: 30000 })
await page.waitForTimeout(2500)
await page.evaluate(() => ((window).__summaryCalls.length = 0))

const t0 = Date.now()
await page.evaluate(t => ((window).__t0 = t), t0)
// Timeline: when does an assistant bubble appear, and when does the composer
// re-enable (= the turn finished)? Lets each traced fetch be attributed.
await page.evaluate(() => {
  ;(window).__marks = []
  const mark = (n) => (window).__marks.push(`${Date.now()} ${n}`)
  let sawAssistant = false
  let sawEnabled = false
  setInterval(() => {
    const a = document.querySelector('[data-role="assistant"]')
    if (a && !sawAssistant) { sawAssistant = true; mark('assistant-bubble-appeared') }
    const btns = Array.from(document.querySelectorAll('button'))
    const spin = document.querySelector('[data-chat-composer] .animate-spin')
    if (!spin && sawAssistant && !sawEnabled) { sawEnabled = true; mark('composer-spinner-cleared') }
    void btns
  }, 100)
})
await page.fill('textarea', 'trace probe: reply with one short word')
await page.press('textarea', 'Enter')
await page.waitForTimeout(25000)
const marks = await page.evaluate(() => (window).__marks)
console.log('\n=== marks (ms since send) ===')
for (const m of marks) {
  const [ts, name] = m.split(' ')
  console.log(`  +${Number(ts) - t0}ms ${name}`)
}

const calls = await page.evaluate(() => (window).__summaryCalls)
console.log(`\n=== ${calls.length} traced calls (ms since send) ===`)
for (const c of calls) {
  const [head, ...stack] = c.split('\n')
  console.log('\n>> +' + (Number(head.split(' ')[0]) - t0) + 'ms ' + head.split(' ')[1])
  console.log(
    stack
      .filter(l => l.includes('assets/'))
      .slice(0, 6)
      .map(l => '   ' + l.trim())
      .join('\n'),
  )
}
await browser.close()
