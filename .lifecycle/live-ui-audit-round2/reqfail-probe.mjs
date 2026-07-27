// Focused probe: capture the FAILURE REASON of every /api request on a cold boot,
// plus HTTP protocol + timing, so a "serial chain" can be classified as a real
// dependency vs connection-limit queueing vs an abort+retry.
import { chromium } from '@playwright/test'

const BASE = process.argv.find(a => a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:1560'
const SETTLE = Number(process.argv.find(a => a.startsWith('--settle='))?.slice(9) ?? 6000)

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'password123' }),
})
const body = await res.json()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => {
  localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: t, user: u, isAuthenticated: true, expiresAt: Date.now() + 20 * 3600 * 1000 },
    version: 0,
  }))
}, [body.access_token ?? body.token, body.user])

const t0 = Date.now()
const rows = []
const started = new Map()
page.on('request', r => started.set(r, Date.now() - t0))
page.on('response', async r => {
  const req = r.request()
  let t = null
  try { t = req.timing() } catch { t = null }
  rows.push({
    kind: 'ok', url: new URL(req.url()).pathname, method: req.method(), status: r.status(),
    start: started.get(req), end: Date.now() - t0,
    // stalled = time between the browser deciding to send and actually sending
    stalledMs: t ? Math.round(t.requestStart - Math.max(0, t.connectStart >= 0 ? t.connectStart : 0)) : null,
    reqStart: t ? Math.round(t.requestStart) : null,
    respStart: t ? Math.round(t.responseStart) : null,
  })
})
page.on('requestfailed', r => {
  rows.push({
    kind: 'FAIL', url: new URL(r.url()).pathname, method: r.method(),
    error: r.failure()?.errorText, start: started.get(r), end: Date.now() - t0,
  })
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(SETTLE)

const api = rows.filter(r => r.url.startsWith('/api'))
console.log('--- /api requests, start-ordered ---')
for (const r of api.sort((a, b) => a.start - b.start)) {
  console.log(
    `${String(r.start).padStart(5)}-${String(r.end).padStart(5)} ${r.kind === 'FAIL' ? 'FAIL' : String(r.status).padStart(4)} ${r.method} ${r.url}` +
      (r.kind === 'FAIL' ? `   << ${r.error}` : ` (reqStart=${r.reqStart} respStart=${r.respStart})`),
  )
}
const assets = rows.filter(r => !r.url.startsWith('/api'))
console.log(`\n--- non-/api: ${assets.length} (failed: ${assets.filter(r => r.kind === 'FAIL').length}) ---`)
for (const r of assets.filter(r => r.kind === 'FAIL').slice(0, 15)) console.log(`  FAIL ${r.url} << ${r.error}`)
console.log('\nprotocol:', await page.evaluate(() => performance.getEntriesByType('resource').slice(0, 3).map(e => e.nextHopProtocol)))
await browser.close()
