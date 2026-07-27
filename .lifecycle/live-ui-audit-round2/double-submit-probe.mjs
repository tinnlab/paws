// The audit's `rapid-double-submit` step, reproduced LITERALLY, with the
// measurements the audit does not take: how many sends/conversations the double
// keypress produced, and when the composer spinner actually clears.
import { chromium } from '@playwright/test'

const BASE = process.argv.find(a => a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:1560'
const VP = Number(process.argv.find(a => a.startsWith('--vp='))?.slice(5) ?? 390)

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'password123' }),
})
const body = await login.json()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: VP, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => {
  localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: t, user: u, isAuthenticated: true, expiresAt: Date.now() + 20 * 3600 * 1000 },
    version: 0,
  }))
}, [body.access_token ?? body.token, body.user])

const posts = []
page.on('request', r => {
  const p = new URL(r.url()).pathname
  if (r.method() === 'POST' && (p === '/api/conversations' || /\/messages$/.test(p))) {
    posts.push(`${Date.now()} POST ${p}`)
  }
})
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea', { timeout: 30000 })
await page.waitForTimeout(2500)

const t0 = Date.now()
await page.fill('textarea', 'rapid test 🚀 <script>x</script> "quoted" \\n')
await page.press('textarea', 'Enter')
await page.press('textarea', 'Enter')

const snap = async () => page.evaluate(() => ({
  spinners: document.querySelectorAll('.animate-spin, [role="progressbar"], [aria-busy="true"]').length,
  user: document.querySelectorAll('[data-role="user"]').length,
  assistant: document.querySelectorAll('[data-role="assistant"]').length,
  assistantLen: [...document.querySelectorAll('[data-role="assistant"]')].map(e => e.innerText.length),
}))

for (const at of [4000, 6000, 8000, 12000, 20000, 30000]) {
  const wait = at - (Date.now() - t0)
  if (wait > 0) await page.waitForTimeout(wait)
  const s = await snap()
  console.log(`+${at}ms spinners=${s.spinners} user=${s.user} assistant=${s.assistant} lens=${JSON.stringify(s.assistantLen)}`)
}

console.log('\nPOSTs:')
for (const p of posts) console.log(`  +${Number(p.split(' ')[0]) - t0}ms ${p.split(' ').slice(1).join(' ')}`)
console.log('\nconsole errors:', errors.length)
for (const e of errors.slice(0, 8)) console.log('  ', e)
await browser.close()
