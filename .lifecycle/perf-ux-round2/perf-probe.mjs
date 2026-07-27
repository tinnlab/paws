#!/usr/bin/env node
/**
 * perf-probe — repeatable, objective performance measurement for a RUNNING ziee
 * instance serving a PRODUCTION build. Three probes, all evidence-emitting:
 *
 *   1. `bundle`   — critical-path bytes: the entry chunk + every `modulepreload`
 *                   + every stylesheet in index.html (raw + gzip). This is the
 *                   number that actually gates first paint; the ENTRY chunk size
 *                   alone is misleading (a vendor split moves bytes, it does not
 *                   remove them from the critical path).
 *   2. `boot`     — first-paint request waterfall: every request until network
 *                   idle, its start/end, and the DEPENDENCY DEPTH (longest chain
 *                   of requests each of which started after the previous ended).
 *   3. `stream`   — CPU profile of a long streamed assistant reply. Drives the
 *                   real composer against the configured model, records a V8 CPU
 *                   profile over the whole stream, and reports self-time by
 *                   function. This is the probe that found the O(n^2) reducer.
 *
 * Usage:
 *   node perf-probe.mjs --url=http://127.0.0.1:1571 --user=admin --password=pw \
 *     --dist=/path/to/src-app/dist/ui --probes=bundle,boot,stream --out=<dir>
 *
 * Everything is measured against a build of the CURRENT branch — pass `--dist`
 * so the probe can prove the served asset hashes match that build (a stale dist
 * has produced phantom findings before).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = (arg('url', 'http://127.0.0.1:1571') || '').replace(/\/$/, '')
const USER = arg('user', 'admin')
const PASS = arg('password', 'password123')
const DIST = arg('dist', '')
const OUT = arg('out', path.join(process.cwd(), 'perf-probe-out'))
const PROBES = arg('probes', 'bundle,boot,stream').split(',').filter(Boolean)
const PROMPT = arg(
  'prompt',
  'Write a detailed 900-word explanation of how a B-tree index works in PostgreSQL. Use several paragraphs and a bulleted list.',
)

const gz = buf => zlib.gzipSync(buf, { level: 9 }).length

async function loadChromium() {
  const req = createRequire(import.meta.url)
  for (const root of [
    process.env.PLAYWRIGHT_DIR,
    process.cwd(),
    '/data/pbya/ziee/ziee',
  ].filter(Boolean)) {
    try {
      return req(req.resolve('@playwright/test', { paths: [root] })).chromium
    } catch {}
  }
  return (await import('@playwright/test')).chromium
}

// ── probe 1: critical-path bundle bytes ────────────────────────────────────
async function probeBundle(report) {
  const html = await (await fetch(`${BASE}/index.html`)).text()
  const entry = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(m => m[1])
  const preload = [...html.matchAll(/rel="modulepreload"[^>]*href="([^"]+)"/g)].map(m => m[1])
  const css = [...html.matchAll(/rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1])

  const rows = []
  let jsRaw = 0, jsGz = 0, cssRaw = 0, cssGz = 0
  for (const [kind, list] of [['entry', entry], ['modulepreload', preload], ['stylesheet', css]]) {
    for (const url of list) {
      const buf = Buffer.from(await (await fetch(BASE + url)).arrayBuffer())
      const g = gz(buf)
      rows.push({ kind, url, raw: buf.length, gzip: g })
      if (kind === 'stylesheet') { cssRaw += buf.length; cssGz += g }
      else { jsRaw += buf.length; jsGz += g }
    }
  }
  // Prove the SERVED assets came from --dist (guards against a stale build).
  let distMatch = null
  if (DIST) {
    distMatch = rows.every(r => fs.existsSync(path.join(DIST, r.url.replace(/^\//, ''))))
  }
  report.bundle = {
    distVerified: distMatch,
    criticalJs: { raw: jsRaw, gzip: jsGz },
    criticalCss: { raw: cssRaw, gzip: cssGz },
    criticalTotal: { raw: jsRaw + cssRaw, gzip: jsGz + cssGz },
    chunkCount: rows.length,
    rows: rows.sort((a, b) => b.raw - a.raw),
  }
  console.log(
    `bundle: critical-path ${(jsRaw + cssRaw).toLocaleString()} B raw / ` +
    `${(jsGz + cssGz).toLocaleString()} B gzip across ${rows.length} assets` +
    (distMatch === null ? '' : distMatch ? ' [dist-verified]' : ' [!! SERVED ASSETS NOT IN --dist — STALE BUILD]'),
  )
  for (const r of report.bundle.rows.slice(0, 10))
    console.log(`   ${String(r.raw).padStart(9)}  gz ${String(r.gzip).padStart(8)}  ${r.url}`)
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!res.ok) throw new Error(`login failed ${res.status}: ${await res.text()}`)
  const j = await res.json()
  if (!j.access_token) throw new Error('login returned no access_token')
  return j.access_token
}

async function newContext(chromium, token) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(t => {
    try {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { token: t, isAuthenticated: true }, version: 0 }),
      )
    } catch {}
  }, token)
  return { browser, ctx }
}

// ── probe 2: first-paint waterfall depth ───────────────────────────────────
async function probeBoot(chromium, token, report, throttle) {
  const { browser, ctx } = await newContext(chromium, token)
  const page = await ctx.newPage()
  if (throttle) {
    // Loopback hides request-COUNT cost entirely (every chunk is ~0 ms), so a
    // build split into 200+ tiny chunks looks free. Emulating a real RTT is the
    // only honest way to price the chunk count + waterfall depth a remote user
    // actually pays. Profile ≈ good broadband with 100 ms RTT.
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
    })
  }
  const t0 = Date.now()
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  // User-facing paint/interactive marks: FCP, and the moment the primary
  // affordance of the landing surface (the chat composer) is actually in the DOM.
  const composerAt = await page
    .evaluate(async () => {
      const sel =
        '[data-testid="chat-message-textarea"], textarea[placeholder*="Type your message"], textarea'
      const t = performance.now()
      if (document.querySelector(sel)) return performance.now()
      return await new Promise(res => {
        const obs = new MutationObserver(() => {
          if (document.querySelector(sel)) { obs.disconnect(); res(performance.now()) }
        })
        obs.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => { obs.disconnect(); res(-1) }, 20000 - (performance.now() - t))
      })
    })
    .catch(() => -1)
  // Settle: the app shell keeps prefetching at idle, so `networkidle` may never
  // arrive. Cap at 25 s and measure what happened in that window.
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {})
  const wall = Date.now() - t0

  // Read the Resource Timing API rather than Playwright request events: it
  // carries `initiatorType`, which is the ONLY way to separate a chunk the app
  // actually EXECUTED (`script`) from one the idle prefetcher merely warmed
  // (`link`). Conflating the two is what makes a boot look like 1500 requests.
  const timing = await page.evaluate(() =>
    performance.getEntriesByType('resource').map(e => ({
      url: e.name,
      init: e.initiatorType,
      start: e.startTime,
      end: e.responseEnd,
      size: e.transferSize || 0,
    })),
  )
  const rel = u => u.replace(BASE, '')
  const reqs = timing.map(r => ({ ...r, url: rel(r.url) }))

  const scripts = reqs.filter(r => r.init === 'script')
  const prefetched = reqs.filter(r => r.init === 'link' && r.url.endsWith('.js'))
  const api = reqs.filter(r => r.url.includes('/api/'))

  // Dependency depth over the EXECUTED graph only: the longest chain in which
  // each request starts after the previous one ended (so it could only have
  // been issued because the previous one resolved). Prefetches are parallel by
  // construction and would inflate this to meaninglessness.
  const chainOf = list => {
    const s = [...list].sort((a, b) => a.start - b.start)
    const d = new Array(s.length).fill(1)
    const p = new Array(s.length).fill(-1)
    for (let i = 0; i < s.length; i++)
      for (let j = 0; j < i; j++)
        if (s[j].end <= s[i].start && d[j] + 1 > d[i]) { d[i] = d[j] + 1; p[i] = j }
    let e = d.indexOf(Math.max(...d, 0))
    const out = []
    while (e >= 0) { out.unshift(s[e]); e = p[e] }
    return { depth: Math.max(...d, 0), chain: out }
  }
  const exec = chainOf(scripts)
  const apiChain = chainOf(api)

  const dupes = {}
  for (const r of api) dupes[r.url] = (dupes[r.url] || 0) + 1
  const byInit = {}
  for (const r of reqs) byInit[r.init] = (byInit[r.init] || 0) + 1

  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      fcpMs: fcp ? +fcp.startTime.toFixed(0) : null,
      domContentLoadedMs: nav ? +nav.domContentLoadedEventEnd.toFixed(0) : null,
      loadMs: nav ? +nav.loadEventEnd.toFixed(0) : null,
    }
  })

  report.boot = {
    wallMs: wall,
    ...paint,
    composerReadyMs: composerAt < 0 ? null : +composerAt.toFixed(0),
    byInitiatorType: byInit,
    requests: reqs.length,
    executedChunks: scripts.length,
    prefetchedChunks: prefetched.length,
    apiRequests: api.length,
    executedBytes: scripts.reduce((a, b) => a + b.size, 0),
    prefetchedBytes: prefetched.reduce((a, b) => a + b.size, 0),
    execWaterfallDepth: exec.depth,
    apiWaterfallDepth: apiChain.depth,
    longestExecChain: exec.chain.map(c => `${c.url} [${c.start.toFixed(0)}→${c.end.toFixed(0)}ms]`),
    longestApiChain: apiChain.chain.map(c => `${c.url} [${c.start.toFixed(0)}→${c.end.toFixed(0)}ms]`),
    duplicateApi: Object.entries(dupes).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
    executedList: scripts.map(s => s.url),
  }
  console.log(
    `boot: ${wall} ms window · ${reqs.length} requests total — ` +
    `${scripts.length} EXECUTED chunks (${(report.boot.executedBytes / 1024).toFixed(0)} KiB), ` +
    `${prefetched.length} idle-PREFETCHED chunks (${(report.boot.prefetchedBytes / 1024).toFixed(0)} KiB), ` +
    `${api.length} /api`,
  )
  console.log(
    `  FCP ${paint.fcpMs} ms · DCL ${paint.domContentLoadedMs} ms · ` +
    `composer interactive ${report.boot.composerReadyMs} ms`,
  )
  console.log(`  executed-chunk waterfall depth ${exec.depth} · /api chain depth ${apiChain.depth}`)
  for (const l of report.boot.longestApiChain) console.log('   ↳ api ' + l)
  for (const l of report.boot.longestExecChain.slice(0, 12)) console.log('   ↳ js  ' + l)
  for (const [u, n] of report.boot.duplicateApi) console.log(`   duplicate x${n}: ${u}`)
  await browser.close()
}

// ── probe 3: CPU profile of a long streamed reply ──────────────────────────
async function probeStream(chromium, token, report) {
  const { browser, ctx } = await newContext(chromium, token)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

  const INPUT =
    '[data-testid="chat-message-textarea"], textarea[placeholder*="Type your message"], textarea'
  const box = page.locator(INPUT).first()
  if (!(await box.count())) {
    report.stream = { error: 'composer not found' }
    console.log('stream: SKIP — composer not found')
    await browser.close()
    return
  }
  await box.click()
  await box.fill(PROMPT)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')

  const t0 = Date.now()
  await box.press('Enter')
  // Wait for the stream to settle: no DOM growth in the message list for 4 s,
  // or a 180 s ceiling.
  let stableSince = Date.now(), lastLen = -1
  while (Date.now() - t0 < 180000) {
    const len = await page.evaluate(() => document.body.innerText.length)
    if (len !== lastLen) { lastLen = len; stableSince = Date.now() }
    else if (Date.now() - stableSince > 4000) break
    await page.waitForTimeout(400)
  }
  const wall = Date.now() - t0
  const { profile } = await cdp.send('Profiler.stop')

  // Aggregate SELF time per function from the sample stream.
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  const dt = profile.timeDeltas || []
  profile.samples.forEach((id, i) => {
    const n = byId.get(id)
    if (!n) return
    const f = n.callFrame
    const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber}`
    self.set(key, (self.get(key) || 0) + (dt[i] || 0))
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  // "(idle)"/"(program)"/"(garbage collector)" are V8 pseudo-frames, not app
  // work — busy% must exclude (idle) or a mostly-idle stream reads as 100%.
  const idle = self.get('(idle) @ :-1') || 0
  const busy = total - idle
  const top = [...self.entries()]
    .filter(([k]) => !k.startsWith('(idle) '))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)

  report.stream = {
    wallMs: wall,
    replyChars: lastLen,
    sampledUs: total,
    idleUs: idle,
    busyUs: busy,
    cpuBusyPct: +((busy / 1000 / wall) * 100).toFixed(1),
    topSelfTime: top.map(([k, v]) => ({ fn: k, selfMs: +(v / 1000).toFixed(1), pctOfBusy: +((v / busy) * 100).toFixed(2) })),
  }
  console.log(
    `stream: ${wall} ms wall · ${lastLen} chars rendered · main-thread busy ` +
    `${(busy / 1000).toFixed(0)} ms (${report.stream.cpuBusyPct}% of wall)`,
  )
  for (const r of report.stream.topSelfTime.slice(0, 15))
    console.log(`   ${String(r.pctOfBusy).padStart(6)}%  ${String(r.selfMs).padStart(7)} ms  ${r.fn}`)
  fs.writeFileSync(path.join(OUT, 'stream.cpuprofile'), JSON.stringify(profile))
  await browser.close()
}

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const report = { base: BASE, at: new Date().toISOString() }
  if (PROBES.includes('bundle')) await probeBundle(report)
  const needsBrowser = PROBES.includes('boot') || PROBES.includes('boot-slow') || PROBES.includes('stream')
  if (needsBrowser) {
    const chromium = await loadChromium()
    const token = await login()
    if (PROBES.includes('boot')) await probeBoot(chromium, token, report, false)
    if (PROBES.includes('boot-slow')) { const r2 = {}; await probeBoot(chromium, token, r2, true); report.bootSlow = r2.boot }
    if (PROBES.includes('stream')) await probeStream(chromium, token, report)
  }
  fs.writeFileSync(path.join(OUT, 'perf-probe.json'), JSON.stringify(report, null, 2))
  console.log(`\nwrote ${path.join(OUT, 'perf-probe.json')}`)
}

main().catch(e => { console.error(e); process.exit(1) })
